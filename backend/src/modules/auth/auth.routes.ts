import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { BadRequest, Conflict, Forbidden, Unauthorized } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { sendVerification, verifyToken, resendVerification } from './verification.service.js';

const registerBody = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
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

  app.post('/register', async (req) => {
    const body = registerBody.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw Conflict('An account with this email already exists');

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone,
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
      reply.type('text/html').send(resultPage(true, 'Your email is verified. You can return to the MOTORIQ app.'));
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

function resultPage(ok: boolean, message: string): string {
  const color = ok ? '#16A34A' : '#DC2626';
  const icon = ok ? '✓' : '✕';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MOTORIQ</title></head>
  <body style="font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#F6F8FB;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center">
    <div style="background:#fff;border:1px solid #E1E7EF;border-radius:16px;padding:32px;max-width:420px;text-align:center">
      <div style="width:56px;height:56px;border-radius:50%;background:${color}1a;color:${color};font-size:28px;line-height:56px;margin:0 auto 16px">${icon}</div>
      <h2 style="margin:0 0 8px;color:#0B2545">${ok ? 'Email verified' : 'Verification failed'}</h2>
      <p style="color:#475569;margin:0">${message}</p>
    </div>
  </body></html>`;
}
