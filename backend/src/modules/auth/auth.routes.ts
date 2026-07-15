import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { BadRequest, Conflict, Unauthorized } from '../../lib/errors.js';
import { env } from '../../config/env.js';

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

    const tokens = await issueTokens(user);
    return { user: publicUser(user), ...tokens };
  });

  app.post('/login', async (req) => {
    const body = loginBody.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
      throw Unauthorized('Invalid email or password');
    }
    const tokens = await issueTokens(user);
    return { user: publicUser(user), ...tokens };
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
}) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    tier: u.tier,
  };
}
