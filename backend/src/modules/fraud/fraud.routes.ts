import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';

/**
 * Read-only view of a member's own risk events. In a full build this would
 * sit behind an admin/ops role for the whole population plus a review queue.
 */
export default async function fraudRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);

  app.get('/events', async (req) => {
    const { decision } = z
      .object({ decision: z.enum(['ALLOW', 'REVIEW', 'BLOCK']).optional() })
      .parse(req.query);
    return prisma.riskEvent.findMany({
      where: { userId: req.authUser.sub, ...(decision ? { decision } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  // Simple risk summary for the member's dashboard.
  app.get('/summary', async (req) => {
    const grouped = await prisma.riskEvent.groupBy({
      by: ['decision'],
      where: { userId: req.authUser.sub },
      _count: { _all: true },
    });
    return {
      counts: Object.fromEntries(grouped.map((g) => [g.decision, g._count._all])),
    };
  });
}
