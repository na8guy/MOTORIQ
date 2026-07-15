import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { BadRequest } from '../../lib/errors.js';
import type { SubPlan, Tier } from '@prisma/client';

/**
 * Plan catalogue derived from the MOTORIQ business plan.
 * Prices are monthly, in pence. DRIVE plans carry a mileage package.
 */
export const PLAN_CATALOGUE = {
  FREE: { priceMinor: 0, label: 'MOTORIQ Free', mileagePackages: [] as number[] },
  PLUS: { priceMinor: 599, label: 'MOTORIQ Plus', mileagePackages: [] as number[] },
  DRIVE: { priceMinor: 0, label: 'MOTORIQ Drive', mileagePackages: [500, 1000, 1500] },
  DRIVE_PLUS: { priceMinor: 2000, label: 'MOTORIQ Drive+', mileagePackages: [500, 1000, 1500] },
} as const;

const subscribeBody = z.object({
  plan: z.enum(['FREE', 'PLUS', 'DRIVE', 'DRIVE_PLUS']),
  mileagePackage: z.number().int().optional(),
});

export default async function subscriptionsRoutes(app: FastifyInstance): Promise<void> {
  // Public: anyone can view the plan catalogue.
  app.get('/plans', async () => {
    return Object.entries(PLAN_CATALOGUE).map(([plan, cfg]) => ({ plan, ...cfg }));
  });

  app.register(async (secured) => {
    secured.addHook('onRequest', app.authenticate);

    secured.get('/me', async (req) => {
      return prisma.subscription.findUnique({ where: { userId: req.authUser.sub } });
    });

    secured.post('/', async (req) => {
      const body = subscribeBody.parse(req.body);
      const cfg = PLAN_CATALOGUE[body.plan];

      if (cfg.mileagePackages.length > 0) {
        const packages = cfg.mileagePackages as readonly number[];
        if (!body.mileagePackage || !packages.includes(body.mileagePackage)) {
          throw BadRequest(
            `${cfg.label} requires a mileage package: ${cfg.mileagePackages.join(', ')}`,
          );
        }
      }

      const renewsAt = new Date();
      renewsAt.setMonth(renewsAt.getMonth() + 1);

      const [subscription] = await prisma.$transaction([
        prisma.subscription.upsert({
          where: { userId: req.authUser.sub },
          create: {
            userId: req.authUser.sub,
            plan: body.plan as SubPlan,
            priceMinor: cfg.priceMinor,
            mileagePackage: body.mileagePackage,
            status: 'ACTIVE',
            renewsAt,
          },
          update: {
            plan: body.plan as SubPlan,
            priceMinor: cfg.priceMinor,
            mileagePackage: body.mileagePackage,
            status: 'ACTIVE',
            renewsAt,
            cancelledAt: null,
          },
        }),
        prisma.user.update({
          where: { id: req.authUser.sub },
          data: { tier: body.plan as Tier },
        }),
      ]);

      return subscription;
    });

    secured.post('/cancel', async (req) => {
      const subscription = await prisma.subscription.update({
        where: { userId: req.authUser.sub },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      await prisma.user.update({ where: { id: req.authUser.sub }, data: { tier: 'FREE' } });
      return subscription;
    });
  });
}
