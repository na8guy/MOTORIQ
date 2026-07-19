import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import {
  checkPassword,
  hashPassword,
  passwordSchema,
  verifyPassword,
} from '../../lib/password.js';
import { BadRequest, Conflict, Forbidden, Unauthorized } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import {
  requestPasswordReset,
  resendVerification,
  resetPassword,
  sendVerification,
  verifyToken,
} from './verification.service.js';

const registerBody = z.object({
  email: z.string().email(),
  password: passwordSchema,
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),

  // ── Consent (UK GDPR) ──
  // `literal(true)` means the request is rejected outright unless the member
  // actively accepted. A default would manufacture consent that was never given.
  acceptTerms: z.literal(true, {
    message: 'You must accept the Terms & Conditions to create an account',
  }),
  acceptPrivacy: z.literal(true, {
    message: 'You must accept the Privacy Policy to create an account',
  }),
  // Separate and optional: consent to marketing must be freely given, so it is
  // never bundled into accepting the terms and never defaults to true.
  marketingOptIn: z.boolean().default(false),
});

const forgotBody = z.object({ email: z.string().email() });
const resetBody = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshBody = z.object({ refreshToken: z.string().min(1) });

const sha256 = (v: string): string => crypto.createHash('sha256').update(v).digest('hex');

function ttlToMs(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) return 30 * 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  const unit = m[2];
  const mult = unit === 's' ? 1e3 : unit === 'm' ? 6e4 : unit === 'h' ? 36e5 : 864e5;
  return n * mult;
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  async function issueTokens(user: { id: string; email: string; tier: string }) {
    const accessToken = app.jwt.sign({ sub: user.id, email: user.email, tier: user.tier });
    const refreshToken = crypto.randomBytes(48).toString('hex');
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + ttlToMs(env.JWT_REFRESH_TTL)),
      },
    });
    return { accessToken, refreshToken };
  }

  /** The documents a member must accept, and the versions currently in force. */
  app.get('/legal', async () => ({
    termsVersion: env.TERMS_VERSION,
    termsUrl: env.TERMS_URL,
    privacyVersion: env.PRIVACY_VERSION,
    privacyUrl: env.PRIVACY_URL,
  }));

  app.post('/register', async (req) => {
    const body = registerBody.parse(req.body);

    // passwordSchema can't see the email, so identity-aware rules ("don't put
    // your own name in your password") are checked here where both are known.
    const strength = checkPassword(body.password, {
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
    });
    if (!strength.ok) throw BadRequest(strength.issues[0]!.message);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw Conflict('An account with this email already exists');

    const now = new Date();
    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone,
        // Record what was accepted and when — consent must be demonstrable,
        // and stamping the version lets us re-ask when the terms change.
        termsAcceptedAt: now,
        termsVersion: env.TERMS_VERSION,
        privacyAcceptedAt: now,
        privacyVersion: env.PRIVACY_VERSION,
        marketingOptIn: body.marketingOptIn,
        // Every user gets a wallet and a free subscription on signup.
        wallet: { create: {} },
        subscription: { create: { plan: 'FREE' } },
      },
    });

    // Send a verification email (best-effort; mock-logs without a Resend key).
    await sendVerification(user);

    const tokens = await issueTokens(user);
    return { user: publicUser(user), ...tokens };
  });

  app.post('/login', async (req) => {
    const body = loginBody.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
      throw Unauthorized('Invalid email or password');
    }
    // Optional hard gate (off by default so no one is locked out).
    if (env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) {
      throw Forbidden('Please verify your email address before signing in');
    }
    const tokens = await issueTokens(user);
    return { user: publicUser(user), ...tokens };
  });

  // Verify via the emailed link (opened in a browser) — returns a small page.
  app.get('/verify', async (req, reply) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.query);
    try {
      await verifyToken(token);
      reply.type('text/html').send(resultPage(true, 'Your email is verified. You can return to the SaveOnDrive app.'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Verification failed';
      reply.code(400).type('text/html').send(resultPage(false, msg));
    }
  });

  // Verify via API (e.g. if the app captures the token) — returns JSON.
  app.post('/verify-email', async (req) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
    const { email } = await verifyToken(token);
    return { verified: true, email };
  });

  // Resend the verification email.
  app.post('/resend-verification', async (req) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    await resendVerification(email);
    return { ok: true };
  });

  // ── Password reset ──

  /**
   * Start a reset. Always returns the same response whether or not the address
   * has an account: a different answer would turn this into a free tool for
   * discovering who has a SaveOnDrive account.
   */
  app.post('/forgot-password', async (req) => {
    const { email } = forgotBody.parse(req.body);
    await requestPasswordReset(email);
    return {
      ok: true,
      message: "If an account exists for that address, we've sent a reset link.",
    };
  });

  /** Complete a reset from the app (token captured from the link). */
  app.post('/reset-password', async (req) => {
    const body = resetBody.parse(req.body);
    const { email } = await resetPassword(body.token, body.password);
    return { ok: true, email };
  });

  /**
   * The emailed reset link opens here in a browser. There's no deep link set up
   * yet, so serve a small self-contained page that posts back to the API rather
   * than dead-ending the member on a blank screen.
   */
  app.get('/reset', async (req, reply) => {
    const parsed = z.object({ token: z.string().min(10) }).safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).type('text/html').send(resultPage(false, 'This reset link is invalid.'));
    }
    reply.type('text/html').send(resetPage(parsed.data.token));
  });

  app.post('/refresh', async (req) => {
    const { refreshToken } = refreshBody.parse(req.body);
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw Unauthorized('Refresh token is invalid or expired');
    }
    // Rotate: revoke the old token, issue a fresh pair.
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const tokens = await issueTokens(stored.user);
    return { user: publicUser(stored.user), ...tokens };
  });

  app.post('/logout', async (req) => {
    const parsed = refreshBody.safeParse(req.body);
    if (!parsed.success) throw BadRequest('refreshToken is required');
    await prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(parsed.data.refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  });
}

function publicUser(u: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  tier: string;
  emailVerified: boolean;
}) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    tier: u.tier,
    emailVerified: u.emailVerified,
  };
}

/**
 * Minimal reset form served to the browser. Self-contained (no external CSS/JS)
 * and it posts the token straight back to /reset-password. The confirm field and
 * length check are here too, so the browser path can't sidestep what the app
 * enforces — the API is still the real gate.
 */
function resetPage(token: string): string {
  const safeToken = token.replace(/[^a-f0-9]/gi, ''); // tokens are hex; never reflect anything else
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset your SaveOnDrive password</title></head>
  <body style="font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#F6F8FB;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center">
    <div style="background:#fff;border:1px solid #E1E7EF;border-radius:16px;padding:32px;max-width:420px;width:90%">
      <div style="background:#1F6FEB;color:#fff;border-radius:8px;padding:4px 8px;font-weight:800;display:inline-block;margin-bottom:16px">SaveOnDrive</div>
      <h2 style="margin:0 0 8px;color:#0B2545">Choose a new password</h2>
      <p style="color:#475569;font-size:14px;margin:0 0 16px">At least 10 characters. Avoid common passwords and your own name.</p>
      <form id="f">
        <input type="password" id="p1" placeholder="New password" autocomplete="new-password" required
          style="width:100%;box-sizing:border-box;padding:12px;border:1px solid #E1E7EF;border-radius:10px;margin-bottom:10px;font-size:15px">
        <input type="password" id="p2" placeholder="Confirm new password" autocomplete="new-password" required
          style="width:100%;box-sizing:border-box;padding:12px;border:1px solid #E1E7EF;border-radius:10px;margin-bottom:14px;font-size:15px">
        <button type="submit" style="width:100%;background:#1F6FEB;color:#fff;border:0;padding:13px;border-radius:10px;font-weight:600;font-size:15px;cursor:pointer">Reset password</button>
      </form>
      <p id="msg" style="font-size:14px;margin:14px 0 0"></p>
    </div>
    <script>
      var f=document.getElementById('f'),m=document.getElementById('msg');
      f.addEventListener('submit',function(e){
        e.preventDefault();
        var a=document.getElementById('p1').value,b=document.getElementById('p2').value;
        if(a!==b){m.style.color='#DC2626';m.textContent='Passwords do not match.';return;}
        m.style.color='#475569';m.textContent='Saving…';
        fetch('/api/v1/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({token:${JSON.stringify(safeToken)},password:a})})
        .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
        .then(function(res){
          if(res.ok){f.style.display='none';m.style.color='#16A34A';m.textContent='Password reset. You can now sign in with your new password in the SaveOnDrive app.';}
          else{m.style.color='#DC2626';m.textContent=(res.j&&res.j.error&&res.j.error.message)||'Could not reset password.';}
        })
        .catch(function(){m.style.color='#DC2626';m.textContent='Network error — please try again.';});
      });
    </script>
  </body></html>`;
}

function resultPage(ok: boolean, message: string): string {
  const color = ok ? '#16A34A' : '#DC2626';
  const icon = ok ? '✓' : '✕';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SaveOnDrive</title></head>
  <body style="font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#F6F8FB;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center">
    <div style="background:#fff;border:1px solid #E1E7EF;border-radius:16px;padding:32px;max-width:420px;text-align:center">
      <div style="width:56px;height:56px;border-radius:50%;background:${color}1a;color:${color};font-size:28px;line-height:56px;margin:0 auto 16px">${icon}</div>
      <h2 style="margin:0 0 8px;color:#0B2545">${ok ? 'Email verified' : 'Verification failed'}</h2>
      <p style="color:#475569;margin:0">${message}</p>
    </div>
  </body></html>`;
}
