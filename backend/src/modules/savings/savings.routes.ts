import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';

const categories = ['FUEL', 'EV_CHARGING', 'INSURANCE', 'SERVICE', 'MOT', 'CASHBACK', 'OTHER'] as const;

const createBody = z.object({
  category: z.enum(categories),
  amount: z.number().positive(), // pounds saved
  description: z.string().optional(),
  occurredAt: z.coerce.date().optional(),
});

export default async function savingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);

  // Savings dashboard: records + totals by category.
  app.get('/', async (req) => {
    const records = await prisma.savingsRecord.findMany({
      where: { userId: req.authUser.sub },
      orderBy: { occurredAt: 'desc' },
    });
    const byCategory = await prisma.savingsRecord.groupBy({
      by: ['category'],
      where: { userId: req.authUser.sub },
      _sum: { amountMinor: true },
    });
    const totalMinor = byCategory.reduce((acc, c) => acc + (c._sum.amountMinor ?? 0), 0);
    return {
      totalMinor,
      byCategory: byCategory.map((c) => ({
        category: c.category,
        totalMinor: c._sum.amountMinor ?? 0,
      })),
      records,
    };
  });

  app.post('/', async (req, reply) => {
    const body = createBody.parse(req.body);
    const record = await prisma.savingsRecord.create({
      data: {
        userId: req.authUser.sub,
        category: body.category,
        amountMinor: Math.round(body.amount * 100),
        description: body.description,
        occurredAt: body.occurredAt ?? new Date(),
      },
    });
    reply.code(201);
    return record;
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const owned = await prisma.savingsRecord.findFirst({
      where: { id, userId: req.authUser.sub },
    });
    if (!owned) throw NotFound('Savings record not found');
    await prisma.savingsRecord.delete({ where: { id } });
    reply.code(204);
    return null;
  });
}
