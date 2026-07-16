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
  const subject = 'Verify your MOTORIQ email';
  const html = `
  <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
    <div style="background:#0B2545;color:#fff;padding:20px;border-radius:14px 14px 0 0">
      <span style="background:#1F6FEB;border-radius:8px;padding:4px 8px;font-weight:800">MOTORIQ</span>
    </div>
    <div style="border:1px solid #E1E7EF;border-top:0;border-radius:0 0 14px 14px;padding:24px">
      <h2 style="margin:0 0 8px">Confirm your email</h2>
      <p style="color:#475569">Hi ${escapeHtml(params.name)}, welcome to MOTORIQ — the smart membership for cheaper driving. Please confirm your email address to finish setting up your account.</p>
      <p style="margin:24px 0">
        <a href="${params.link}" style="background:#1F6FEB;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">Verify my email</a>
      </p>
      <p style="color:#94a3b8;font-size:13px">Or paste this link into your browser:<br><a href="${params.link}" style="color:#1F6FEB">${params.link}</a></p>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">This link expires in 24 hours. If you didn't create a MOTORIQ account, you can ignore this email.</p>
    </div>
  </div>`;
  const text = `Verify your MOTORIQ email\n\nHi ${params.name}, confirm your email to finish setting up your account:\n${params.link}\n\nThis link expires in 24 hours.`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
