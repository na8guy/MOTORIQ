import crypto from 'node:crypto';
import type { TokenPurpose } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { BadRequest } from '../../lib/errors.js';
import {
  passwordResetEmail,
  sendEmail,
  verificationEmail,
} from '../../integrations/email/resend.js';
import { hashPassword } from '../../lib/password.js';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24h
// Deliberately short: a reset link is a bearer credential for the account.
const RESET_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * Tokens are stored as SHA-256 hashes, never in plain text. A reset token is a
 * bearer credential — anyone holding one can take the account — so a leaked or
 * over-shared database backup must not hand out working links. We hash rather
 * than encrypt because we only ever need to compare, never to read one back.
 *
 * SHA-256 (not argon2) is right here: the token is 32 random bytes, so there is
 * no low-entropy secret to slow a brute-forcer down, and this runs on every
 * click.
 */
const hashToken = (raw: string): string => crypto.createHash('sha256').update(raw).digest('hex');

/** Where verification/reset links point. Render provides the full external URL. */
function publicBase(): string {
  return (process.env.RENDER_EXTERNAL_URL || env.APP_PUBLIC_URL || 'http://localhost:4000').replace(
    /\/$/,
    '',
  );
}

/** Mint a token, storing only its hash, and return the raw value for the link. */
async function issueToken(userId: string, purpose: TokenPurpose, ttlMs: number): Promise<string> {
  const raw = crypto.randomBytes(32).toString('hex');
  await prisma.verificationToken.create({
    data: {
      userId,
      token: hashToken(raw),
      purpose,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return raw;
}

/**
 * Look up and validate a token for a specific purpose. Checking `purpose` is
 * what stops an email-verification link being replayed as a password reset.
 */
async function consumableToken(raw: string, purpose: TokenPurpose) {
  const record = await prisma.verificationToken.findUnique({
    where: { token: hashToken(raw) },
    include: { user: true },
  });
  const what = purpose === 'PASSWORD_RESET' ? 'reset' : 'verification';
  if (!record || record.purpose !== purpose) throw BadRequest(`Invalid ${what} link`);
  if (record.usedAt) throw BadRequest('This link has already been used');
  if (record.expiresAt < new Date()) {
    throw BadRequest(`This link has expired — request a new one`);
  }
  return record;
}

// ── Email verification ───────────────────────────────────────────

/** Create a fresh verification token for a user and email them the link. */
export async function sendVerification(user: {
  id: string;
  email: string;
  firstName: string | null;
}): Promise<void> {
  const raw = await issueToken(user.id, 'EMAIL_VERIFY', VERIFY_TTL_MS);
  const link = `${publicBase()}/api/v1/auth/verify?token=${raw}`;
  const email = verificationEmail({ name: user.firstName ?? 'there', link });
  await deliver('verify', user.email, email);
}

/** Verify a token: mark the user verified and consume the token. */
export async function verifyToken(token: string): Promise<{ email: string }> {
  const record = await consumableToken(token, 'EMAIL_VERIFY');
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } }),
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
  return { email: record.user.email };
}

/** Resend a verification email for an address (no-op if already verified). */
export async function resendVerification(emailAddr: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: emailAddr } });
  // The API response must not leak whether the address exists, but log the
  // reason server-side — otherwise a no-op is indistinguishable from a failure.
  if (!user) {
    console.log(`[verify] resend requested for ${emailAddr} — no such account, nothing sent`);
    return;
  }
  if (user.emailVerified) {
    console.log(`[verify] resend requested for ${emailAddr} — already verified, nothing sent`);
    return;
  }
  await sendVerification(user);
}

// ── Password reset ───────────────────────────────────────────────

/**
 * Start a reset. Always resolves, whether or not the address exists — the
 * route returns the same response either way, so this endpoint can't be used to
 * discover which email addresses have MOTORIQ accounts.
 */
export async function requestPasswordReset(emailAddr: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: emailAddr } });
  if (!user) {
    console.log(`[reset] requested for ${emailAddr} — no such account, nothing sent`);
    return;
  }

  // Invalidate any outstanding reset links, so a forwarded or intercepted older
  // email stops working the moment a new one is requested.
  await prisma.verificationToken.updateMany({
    where: { userId: user.id, purpose: 'PASSWORD_RESET', usedAt: null },
    data: { usedAt: new Date() },
  });

  const raw = await issueToken(user.id, 'PASSWORD_RESET', RESET_TTL_MS);
  const link = `${publicBase()}/api/v1/auth/reset?token=${raw}`;
  const email = passwordResetEmail({ name: user.firstName ?? 'there', link });
  await deliver('reset', user.email, email);
}

/**
 * Complete a reset: set the new password, consume the token, and sign every
 * session out. If someone else set this password via a stolen link, the real
 * owner's sessions must not survive — and vice versa.
 */
export async function resetPassword(token: string, newPassword: string): Promise<{ email: string }> {
  const record = await consumableToken(token, 'PASSWORD_RESET');
  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // Revoke refresh tokens — a password reset must end existing sessions.
    prisma.refreshToken.deleteMany({ where: { userId: record.userId } }),
  ]);
  console.log(`[reset] password reset for ${record.user.email}; all sessions revoked`);
  return { email: record.user.email };
}

// ── Delivery ─────────────────────────────────────────────────────

/**
 * Send an email and say plainly what happened. Failures used to be swallowed,
 * which made "no email arrived" impossible to diagnose — the two causes look
 * identical from outside: RESEND_API_KEY unset (nothing is ever sent, and
 * nothing appears in Resend's logs), or EMAIL_FROM using a domain that isn't
 * verified in Resend (the API rejects it).
 */
async function deliver(
  tag: string,
  to: string,
  email: { subject: string; html: string; text: string },
): Promise<void> {
  try {
    const res = await sendEmail({ to, ...email });
    if (res.sent) {
      console.log(`[${tag}] sent to ${to} (resend id ${res.id})`);
    } else {
      console.error(
        `[${tag}] NOT SENT to ${to} — RESEND_API_KEY is not set, so no request was made to ` +
          `Resend (this is why nothing appears in your Resend logs). Set RESEND_API_KEY in ` +
          `the Render dashboard → Environment.`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[${tag}] FAILED to send to ${to}: ${msg}` +
        (msg.includes('domain') || msg.includes('403')
          ? ` — EMAIL_FROM (${env.EMAIL_FROM}) is probably not a domain verified in Resend.`
          : ''),
    );
  }
}
