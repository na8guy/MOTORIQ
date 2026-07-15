import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';

const createBody = z.object({ refereeEmail: z.string().email().optional() });

// Give £10 / Get £10 (business plan).
const REWARD_MINOR = 1000;

function makeCode(): string {
  return `MIQ-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export default async function referralsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (req) => {
    return prisma.referral.findMany({
      where: { referrerId: req.authUser.sub },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.post('/', async (req, reply) => {
    const body = createBody.parse(req.body);
    let code = makeCode();
    // Extremely unlikely collision guard.
    while (await prisma.referral.findUnique({ where: { code } })) code = makeCode();

    const referral = await prisma.referral.create({
      data: {
        referrerId: req.authUser.sub,
        refereeEmail: body.refereeEmail,
        code,
        rewardMinor: REWARD_MINOR,
      },
    });
    reply.code(201);
    return referral;
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const owned = await prisma.referral.findFirst({
      where: { id, referrerId: req.authUser.sub },
    });
    if (!owned) throw NotFound('Referral not found');
    await prisma.referral.delete({ where: { id } });
    reply.code(204);
    return null;
  });
}
