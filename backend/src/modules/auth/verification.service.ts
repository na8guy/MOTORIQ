import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { BadRequest } from '../../lib/errors.js';
import { sendEmail, verificationEmail } from '../../integrations/email/resend.js';

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Create a fresh verification token for a user and email them the link. */
export async function sendVerification(user: {
  id: string;
  email: string;
  firstName: string | null;
}): Promise<void> {
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.verificationToken.create({
    data: { userId: user.id, token, expiresAt: new Date(Date.now() + TTL_MS) },
  });

  // Prefer an explicit APP_PUBLIC_URL; otherwise use Render's auto-provided
  // full external URL; otherwise fall back to the localhost default.
  const base = (process.env.RENDER_EXTERNAL_URL || env.APP_PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, '');
  const link = `${base}/api/v1/auth/verify?token=${token}`;
  const email = verificationEmail({ name: user.firstName ?? 'there', link });
  try {
    const res = await sendEmail({ to: user.email, ...email });
    // eslint-disable-next-line no-console
    console.log(
      res.sent
        ? `[verify] sent to ${user.email} (resend id ${res.id})`
        : `[verify] NOT sent to ${user.email} — RESEND_API_KEY unset (mock mode)`,
    );
  } catch (err) {
    // Don't fail signup if the provider rejects, but never swallow it silently:
    // the most common cause is EMAIL_FROM using a domain not verified in Resend.
    // eslint-disable-next-line no-console
    console.error(`[verify] FAILED to send to ${user.email}:`, err instanceof Error ? err.message : err);
  }
}

/** Verify a token: mark the user verified and consume the token. */
export async function verifyToken(token: string): Promise<{ email: string }> {
  const record = await prisma.verificationToken.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!record) throw BadRequest('Invalid verification link');
  if (record.usedAt) throw BadRequest('This link has already been used');
  if (record.expiresAt < new Date()) throw BadRequest('This link has expired — request a new one');

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
    // eslint-disable-next-line no-console
    console.log(`[verify] resend requested for ${emailAddr} — no such account, nothing sent`);
    return;
  }
  if (user.emailVerified) {
    // eslint-disable-next-line no-console
    console.log(`[verify] resend requested for ${emailAddr} — already verified, nothing sent`);
    return;
  }
  await sendVerification(user);
}
