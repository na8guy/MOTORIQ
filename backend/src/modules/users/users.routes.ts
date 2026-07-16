import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';

const updateBody = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
  /** UK drivers think in miles; km is offered for those who prefer it. */
  distanceUnit: z.enum(['MILES', 'KM']).optional(),
  /**
   * Marketing consent is withdrawable at any time under UK GDPR, so it must be
   * editable here — not only at signup.
   */
  marketingOptIn: z.boolean().optional(),
});

export default async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);

  // Current user profile with a savings summary.
  app.get('/me', async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.authUser.sub },
      include: { subscription: true, wallet: true },
    });
    if (!user) throw NotFound('User not found');

    const savings = await prisma.savingsRecord.aggregate({
      where: { userId: user.id },
      _sum: { amountMinor: true },
    });

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      tier: user.tier,
      emailVerified: user.emailVerified,
      distanceUnit: user.distanceUnit,
      marketingOptIn: user.marketingOptIn,
      termsAcceptedAt: user.termsAcceptedAt,
      privacyAcceptedAt: user.privacyAcceptedAt,
      subscription: user.subscription,
      walletBalanceMinor: user.wallet?.balanceMinor ?? 0,
      totalSavedMinor: savings._sum.amountMinor ?? 0,
    };
  });

  app.patch('/me', async (req) => {
    const body = updateBody.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.authUser.sub },
      data: body,
    });
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      tier: user.tier,
      emailVerified: user.emailVerified,
      distanceUnit: user.distanceUnit,
      marketingOptIn: user.marketingOptIn,
    };
  });

  app.delete('/me', async (req, reply) => {
    await prisma.user.delete({ where: { id: req.authUser.sub } });
    reply.code(204);
    return null;
  });
}
