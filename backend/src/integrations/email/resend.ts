import { request } from 'undici';
import { env } from '../../config/env.js';

/**
 * Resend email client (https://resend.com).
 * POSTs to https://api.resend.com/emails with a Bearer API key.
 *
 * When RESEND_API_KEY is unset the message is logged instead of sent, so the
 * whole verification flow works in development without an account.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(msg: EmailMessage): Promise<{ sent: boolean; id?: string }> {
  if (!env.RESEND_API_KEY) {
    // eslint-disable-next-line no-console
    console.log(`[email:mock] → ${msg.to} · ${msg.subject}`);
    return { sent: false };
  }

  const res = await request('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });

  if (res.statusCode >= 400) {
    const body = await res.body.text();
    throw new Error(`Resend responded ${res.statusCode}: ${body}`);
  }
  const data = (await res.body.json()) as { id?: string };
  return { sent: true, id: data.id };
}

/** Branded verification email. */
export function verificationEmail(params: { name: string; link: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'Verify your SaveOnDrive email';
  const html = `
  <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
    <div style="background:#0B2545;color:#fff;padding:20px;border-radius:14px 14px 0 0">
      <span style="background:#1F6FEB;border-radius:8px;padding:4px 8px;font-weight:800">SaveOnDrive</span>
    </div>
    <div style="border:1px solid #E1E7EF;border-top:0;border-radius:0 0 14px 14px;padding:24px">
      <h2 style="margin:0 0 8px">Confirm your email</h2>
      <p style="color:#475569">Hi ${escapeHtml(params.name)}, welcome to SaveOnDrive — the smart membership for cheaper driving. Please confirm your email address to finish setting up your account.</p>
      <p style="margin:24px 0">
        <a href="${params.link}" style="background:#1F6FEB;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">Verify my email</a>
      </p>
      <p style="color:#94a3b8;font-size:13px">Or paste this link into your browser:<br><a href="${params.link}" style="color:#1F6FEB">${params.link}</a></p>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">This link expires in 24 hours. If you didn't create a SaveOnDrive account, you can ignore this email.</p>
    </div>
  </div>`;
  const text = `Verify your SaveOnDrive email\n\nHi ${params.name}, confirm your email to finish setting up your account:\n${params.link}\n\nThis link expires in 24 hours.`;
  return { subject, html, text };
}

/** Branded password reset email. */
export function passwordResetEmail(params: { name: string; link: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'Reset your SaveOnDrive password';
  const html = `
  <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
    <div style="background:#0B2545;color:#fff;padding:20px;border-radius:14px 14px 0 0">
      <span style="background:#1F6FEB;border-radius:8px;padding:4px 8px;font-weight:800">SaveOnDrive</span>
    </div>
    <div style="border:1px solid #E1E7EF;border-top:0;border-radius:0 0 14px 14px;padding:24px">
      <h2 style="margin:0 0 8px">Reset your password</h2>
      <p style="color:#475569">Hi ${escapeHtml(params.name)}, we got a request to reset your SaveOnDrive password. Choose a new one using the button below.</p>
      <p style="margin:24px 0">
        <a href="${params.link}" style="background:#1F6FEB;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">Choose a new password</a>
      </p>
      <p style="color:#94a3b8;font-size:13px">Or paste this link into your browser:<br><a href="${params.link}" style="color:#1F6FEB">${params.link}</a></p>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">This link expires in 1 hour and can only be used once. <strong>If you didn't ask to reset your password, you can ignore this email</strong> — your password won't change and your account is safe.</p>
    </div>
  </div>`;
  const text = `Reset your SaveOnDrive password\n\nHi ${params.name}, choose a new password:\n${params.link}\n\nThis link expires in 1 hour and can only be used once.\nIf you didn't request this, ignore this email — your password won't change.`;
  return { subject, html, text };
}

/**
 * Membership changed — upgrade, downgrade, cancellation or an admin change.
 *
 * One template covers all of them because the member's question is always the
 * same: what do I have now, and what changed? A downgrade gets the same clarity
 * as an upgrade — quietly removing features someone was paying for is how you
 * lose their trust permanently.
 */
export function membershipChangedEmail(params: {
  name: string;
  fromTier: string;
  toTier: string;
  reason: 'checkout' | 'renewal' | 'cancelled' | 'payment_failed' | 'admin' | 'expired';
  highlights: readonly string[];
  perks: { fuelLitresPerMonth: number; motPerYear: number; servicesPerYear: number };
  manageUrl: string;
}): { subject: string; html: string; text: string } {
  const upgrade = params.reason === 'checkout' || params.reason === 'admin';
  const ending = params.reason === 'cancelled' || params.reason === 'expired';

  const subject = ending
    ? `Your SaveOnDrive membership has ended`
    : upgrade
      ? `You're on SaveOnDrive ${params.toTier} 🎉`
      : `Your SaveOnDrive membership is now ${params.toTier}`;

  const headline = ending
    ? 'Your membership has ended'
    : `Welcome to ${escapeHtml(params.toTier)}`;

  const intro = ending
    ? `Your ${escapeHtml(params.fromTier)} membership has ended, so you're back on the free plan. ` +
      `You keep cheapest-fuel search, EV charging and your MOT and tax reminders — ` +
      `the paid perks have stopped.`
    : params.reason === 'payment_failed'
      ? `We couldn't take your payment, so your membership has moved to ${escapeHtml(params.toTier)}. ` +
        `Update your card and we'll put everything back.`
      : `You've moved from ${escapeHtml(params.fromTier)} to ${escapeHtml(params.toTier)}. ` +
        `Here's what's now yours:`;

  const bullets = ending
    ? ''
    : `<ul style="padding-left:18px;margin:16px 0;color:#334155;line-height:1.9">${params.highlights
        .map((h) => `<li>${escapeHtml(h)}</li>`)
        .join('')}</ul>`;

  const perkLine =
    !ending && params.perks.fuelLitresPerMonth > 0
      ? `<p style="background:#ECFDF3;border:1px solid #A7F3D0;border-radius:10px;padding:12px 14px;color:#166534;font-size:14px;margin:0 0 16px">
           <strong>${params.perks.fuelLitresPerMonth} litres</strong> of fuel are on your card now, and again every month.
         </p>`
      : '';

  const html = `
  <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
    <div style="background:#0B2545;color:#fff;padding:20px;border-radius:14px 14px 0 0">
      <span style="background:#1F6FEB;border-radius:8px;padding:4px 8px;font-weight:800">SaveOnDrive</span>
    </div>
    <div style="border:1px solid #E1E7EF;border-top:0;border-radius:0 0 14px 14px;padding:24px">
      <h2 style="margin:0 0 8px">${headline}</h2>
      <p style="color:#475569;margin:0 0 12px">Hi ${escapeHtml(params.name)}, ${intro}</p>
      ${perkLine}
      ${bullets}
      <p style="margin:24px 0">
        <a href="${params.manageUrl}" style="background:#1F6FEB;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">
          ${ending ? 'See membership options' : 'Manage your membership'}
        </a>
      </p>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">
        You can change or cancel your membership at any time. Cancelling keeps your
        features until the end of the period you've already paid for.
      </p>
    </div>
  </div>`;

  const text =
    `${headline}\n\nHi ${params.name}, ${intro.replace(/<[^>]+>/g, '')}\n\n` +
    (ending ? '' : params.highlights.map((h) => `• ${h}`).join('\n') + '\n\n') +
    `Manage your membership: ${params.manageUrl}\n`;

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
