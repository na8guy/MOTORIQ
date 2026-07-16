import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { queryBool } from '../../lib/zod.js';

const reminderTypes = ['MOT', 'ROAD_TAX', 'SERVICE', 'INSURANCE', 'BREAKDOWN', 'OTHER'] as const;

const createBody = z.object({
  type: z.enum(reminderTypes),
  dueDate: z.coerce.date(),
  vehicleId: z.string().optional(),
  note: z.string().optional(),
});

const updateBody = z.object({
  type: z.enum(reminderTypes).optional(),
  dueDate: z.coerce.date().optional(),
  vehicleId: z.string().nullable().optional(),
  note: z.string().optional(),
  completed: z.boolean().optional(),
});

export default async function remindersRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (req) => {
    const { upcoming } = z.object({ upcoming: queryBool }).parse(req.query);
    return prisma.reminder.findMany({
      where: {
        userId: req.authUser.sub,
        ...(upcoming ? { completed: false, dueDate: { gte: new Date() } } : {}),
      },
      orderBy: { dueDate: 'asc' },
    });
  });

  app.post('/', async (req, reply) => {
    const body = createBody.parse(req.body);
    if (body.vehicleId) {
      const owned = await prisma.vehicle.findFirst({
        where: { id: body.vehicleId, userId: req.authUser.sub },
      });
      if (!owned) throw NotFound('Vehicle not found');
    }
    const reminder = await prisma.reminder.create({
      data: { ...body, userId: req.authUser.sub },
    });
    reply.code(201);
    return reminder;
  });

  app.patch('/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = updateBody.parse(req.body);
    const owned = await prisma.reminder.findFirst({ where: { id, userId: req.authUser.sub } });
    if (!owned) throw NotFound('Reminder not found');
    return prisma.reminder.update({ where: { id }, data: body });
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const owned = await prisma.reminder.findFirst({ where: { id, userId: req.authUser.sub } });
    if (!owned) throw NotFound('Reminder not found');
    await prisma.reminder.delete({ where: { id } });
    reply.code(204);
    return null;
  });
}
