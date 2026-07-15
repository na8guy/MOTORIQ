import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { notify } from '../notifications/notifications.service.js';
import type { RiskDecision } from '@prisma/client';

/**
 * Lightweight, explainable fraud-scoring engine.
 *
 * Each rule contributes to a 0–100 risk score with a human-readable reason.
 * The score maps to a decision:
 *   < 40  → ALLOW
 *   40–69 → REVIEW  (allowed but flagged for manual review)
 *   >= 70 → BLOCK   (rejected)
 *
 * Every evaluation is persisted as a RiskEvent for audit and analytics.
 * In production this is where you'd also plug device fingerprinting, IP
 * reputation, and the issuer's own transaction-monitoring signals.
 */

// Per-transaction and rolling limits (pence).
const SINGLE_TXN_LIMIT = 100_000; // £1,000
const DAILY_TOPUP_LIMIT = 200_000; // £2,000 / 24h
const VELOCITY_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const VELOCITY_MAX_COUNT = 8; // transactions per hour

export interface RiskContext {
  userId: string;
  kind: 'TOPUP' | 'SPEND' | 'CARD_ISSUE' | 'LOGIN';
  amountMinor?: number;
  reference?: string;
  ipAddress?: string;
  deviceId?: string;
}

export interface RiskResult {
  decision: RiskDecision;
  score: number;
  reasons: string[];
}

function decisionFor(score: number): RiskDecision {
  if (score >= 70) return 'BLOCK';
  if (score >= 40) return 'REVIEW';
  return 'ALLOW';
}

export async function evaluate(ctx: RiskContext): Promise<RiskResult> {
  const reasons: string[] = [];
  let score = 0;

  const amount = ctx.amountMinor ?? 0;

  // 1. Single-transaction ceiling.
  if (amount > SINGLE_TXN_LIMIT) {
    score += 60;
    reasons.push(`Amount exceeds single-transaction limit (£${(SINGLE_TXN_LIMIT / 100).toFixed(0)})`);
  } else if (amount > SINGLE_TXN_LIMIT * 0.75) {
    score += 20;
    reasons.push('Large transaction (>75% of limit)');
  }

  // 2. New-account heuristic — first 24h is higher risk.
  const user = await prisma.user.findUnique({ where: { id: ctx.userId } });
  if (user && Date.now() - user.createdAt.getTime() < 24 * 3600 * 1000) {
    score += 15;
    reasons.push('Account is less than 24 hours old');
  }

  // 3. KYC gating — unverified users carry elevated risk on money movement.
  if (ctx.kind === 'TOPUP' || ctx.kind === 'SPEND' || ctx.kind === 'CARD_ISSUE') {
    const kyc = await prisma.kycProfile.findUnique({ where: { userId: ctx.userId } });
    if (!kyc || kyc.status !== 'VERIFIED') {
      score += 40;
      reasons.push('Identity not verified (KYC incomplete)');
    } else if (kyc.riskLevel === 'HIGH') {
      score += 25;
      reasons.push('User flagged HIGH risk during KYC');
    }
  }

  // 4. Velocity — too many transactions in the last hour.
  const recentCount = await prisma.riskEvent.count({
    where: {
      userId: ctx.userId,
      kind: ctx.kind,
      createdAt: { gte: new Date(Date.now() - VELOCITY_WINDOW_MS) },
    },
  });
  if (recentCount >= VELOCITY_MAX_COUNT) {
    score += 45;
    reasons.push(`High velocity: ${recentCount} ${ctx.kind} events in the last hour`);
  } else if (recentCount >= VELOCITY_MAX_COUNT - 2) {
    score += 15;
    reasons.push('Elevated transaction velocity');
  }

  // 5. Daily top-up cumulative limit.
  if (ctx.kind === 'TOPUP') {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const wallet = await prisma.wallet.findUnique({ where: { userId: ctx.userId } });
    if (wallet) {
      const agg = await prisma.walletTransaction.aggregate({
        where: { walletId: wallet.id, type: 'TOPUP', createdAt: { gte: since } },
        _sum: { amountMinor: true },
      });
      const todayTotal = (agg._sum.amountMinor ?? 0) + amount;
      if (todayTotal > DAILY_TOPUP_LIMIT) {
        score += 50;
        reasons.push(`Would exceed daily top-up limit (£${(DAILY_TOPUP_LIMIT / 100).toFixed(0)})`);
      }
    }
  }

  score = Math.min(100, score);
  const decision = decisionFor(score);
  if (reasons.length === 0) reasons.push('No risk signals');

  await prisma.riskEvent.create({
    data: {
      userId: ctx.userId,
      kind: ctx.kind,
      decision,
      score,
      reasons,
      amountMinor: ctx.amountMinor,
      reference: ctx.reference,
      ipAddress: ctx.ipAddress,
      deviceId: ctx.deviceId,
    },
  });

  // Flag the member on anything that isn't a clean ALLOW. Best-effort.
  if (decision !== 'ALLOW') {
    await notify(ctx.userId, {
      title: decision === 'BLOCK' ? 'Transaction blocked' : 'Transaction under review',
      body:
        decision === 'BLOCK'
          ? 'We blocked a transaction for your security. Contact support if this was you.'
          : 'A recent transaction is being reviewed for your security.',
      type: 'RISK',
    }).catch(() => {});
  }

  return { decision, score, reasons };
}

/**
 * Evaluate and throw if the transaction is BLOCKED. Returns the result so
 * callers can surface REVIEW flags. Use this to guard money-movement flows.
 */
export async function guard(ctx: RiskContext): Promise<RiskResult> {
  const result = await evaluate(ctx);
  if (result.decision === 'BLOCK') {
    throw new AppError(403, 'RISK_BLOCKED', 'This transaction was blocked by fraud checks', {
      score: result.score,
      reasons: result.reasons,
    });
  }
  return result;
}
