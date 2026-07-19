import type { PerkKind } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { PETROL_PENCE_PER_LITRE, TIERS, type Tier } from '../entitlements/entitlements.js';

/**
 * Membership perks as a ledger.
 *
 * Perks are per-period allowances — 6 litres a month, 1 MOT a year — so they
 * need a record of what was granted and what has been claimed. Without one,
 * "6 litres a month" quietly becomes "6 litres whenever you ask", which is a
 * direct cost to us and a bug that only shows up in the bank balance.
 *
 * The unique key (userId, kind, period) is what makes it safe: granting twice
 * for the same month is a no-op rather than free fuel.
 */

/** "2026-07" for monthly perks, "2026" for annual ones. */
export function periodKey(kind: PerkKind, at: Date = new Date()): string {
  const yearly = kind === 'MOT' || kind === 'SERVICE' || kind === 'BREAKDOWN';
  return yearly
    ? String(at.getUTCFullYear())
    : `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Give a member this period's allowance. Idempotent: called on activation, on
 * every renewal, and by the nightly job, so it must be safe to run repeatedly.
 */
export async function grantPerksForPeriod(
  userId: string,
  tier: Tier,
  at: Date = new Date(),
): Promise<void> {
  const perks = TIERS[tier].perks;

  const grants: { kind: PerkKind; allowance: number; valueMinor: number }[] = [
    {
      kind: 'FUEL_LITRES',
      allowance: perks.fuelLitresPerMonth,
      valueMinor: perks.fuelLitresPerMonth * PETROL_PENCE_PER_LITRE,
    },
    { kind: 'SERVICE', allowance: perks.servicesPerYear, valueMinor: perks.serviceCreditMinor },
    { kind: 'MOT', allowance: perks.motPerYear, valueMinor: perks.motPerYear * 5500 },
    {
      kind: 'BREAKDOWN',
      allowance: perks.breakdownCover === 'NONE' ? 0 : 1,
      valueMinor: perks.breakdownCover === 'PREMIUM' ? 6000 : perks.breakdownCover === 'STANDARD' ? 4000 : 0,
    },
  ];

  for (const g of grants) {
    if (g.allowance <= 0) continue;
    const period = periodKey(g.kind, at);
    const key = { userId_kind_period: { userId, kind: g.kind, period } };

    const existing = await prisma.perkGrant.findUnique({ where: key });

    if (!existing) {
      // create-if-missing rather than upsert, because "leave the row alone"
      // can't be expressed as an upsert `update` clause. The unique key means
      // a race here fails loudly rather than double-granting, and the catch
      // turns that into the no-op it should be.
      await prisma.perkGrant
        .create({ data: { userId, kind: g.kind, period, allowance: g.allowance, valueMinor: g.valueMinor } })
        .catch(() => {
          /* another request created it first — nothing to do */
        });
      continue;
    }

    // Only ever RAISE an allowance. Upgrading mid-month should top someone up,
    // but a downgrade must not claw back litres they may already have spent at
    // the pump — that would overdraw a card we already funded.
    if (existing.allowance < g.allowance) {
      await prisma.perkGrant.update({
        where: { id: existing.id },
        data: { allowance: g.allowance, valueMinor: g.valueMinor },
      });
    }
  }
}

export interface PerkBalance {
  kind: PerkKind;
  period: string;
  allowance: number;
  claimed: number;
  remaining: number;
  valueMinor: number;
}

/** What a member has left this period. */
export async function perkBalances(userId: string, at: Date = new Date()): Promise<PerkBalance[]> {
  const kinds: PerkKind[] = ['FUEL_LITRES', 'SERVICE', 'MOT', 'BREAKDOWN'];
  const rows = await prisma.perkGrant.findMany({
    where: {
      userId,
      OR: kinds.map((kind) => ({ kind, period: periodKey(kind, at) })),
    },
  });
  return rows.map((r) => ({
    kind: r.kind,
    period: r.period,
    allowance: r.allowance,
    claimed: r.claimed,
    remaining: Math.max(0, r.allowance - r.claimed),
    valueMinor: r.valueMinor,
  }));
}

/**
 * Claim against an allowance. Returns false when there isn't enough left,
 * rather than throwing — a member trying to book a second free MOT is an
 * ordinary "no", not an error.
 *
 * The conditional update is what makes this safe under concurrency: two
 * simultaneous claims can't both succeed, because the second one finds
 * `claimed` already raised and matches no rows.
 */
export async function claimPerk(
  userId: string,
  kind: PerkKind,
  amount = 1,
  at: Date = new Date(),
): Promise<{ ok: boolean; remaining: number }> {
  const period = periodKey(kind, at);
  const grant = await prisma.perkGrant.findUnique({
    where: { userId_kind_period: { userId, kind, period } },
  });
  if (!grant) return { ok: false, remaining: 0 };

  const remaining = grant.allowance - grant.claimed;
  if (remaining < amount) return { ok: false, remaining: Math.max(0, remaining) };

  const updated = await prisma.perkGrant.updateMany({
    // Re-assert the claimed value we read: if another request moved it first,
    // this matches nothing and we report the failure rather than overspending.
    where: { id: grant.id, claimed: grant.claimed },
    data: { claimed: grant.claimed + amount },
  });
  if (updated.count === 0) {
    return { ok: false, remaining: Math.max(0, remaining) };
  }
  return { ok: true, remaining: remaining - amount };
}
