import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { Conflict, NotFound } from '../../lib/errors.js';

const fuelTypes = ['PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID', 'PLUGIN_HYBRID', 'LPG'] as const;

const createBody = z.object({
  registration: z.string().min(2).max(10).transform((s) => s.toUpperCase().replace(/\s+/g, '')),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  fuelType: z.enum(fuelTypes).default('PETROL'),
  mileage: z.number().int().min(0).optional(),
});

const updateBody = createBody.partial();

export default async function vehiclesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (req) => {
    return prisma.vehicle.findMany({
      where: { userId: req.authUser.sub },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.get('/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const vehicle = await prisma.vehicle.findFirst({
      where: { id, userId: req.authUser.sub },
    });
    if (!vehicle) throw NotFound('Vehicle not found');
    return vehicle;
  });

  app.post('/', async (req, reply) => {
    const body = createBody.parse(req.body);
    const dup = await prisma.vehicle.findFirst({
      where: { userId: req.authUser.sub, registration: body.registration },
    });
    if (dup) throw Conflict('You already have a vehicle with this registration');

    const vehicle = await prisma.vehicle.create({
      data: { ...body, userId: req.authUser.sub },
    });
    reply.code(201);
    return vehicle;
  });

  app.patch('/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = updateBody.parse(req.body);
    const owned = await prisma.vehicle.findFirst({ where: { id, userId: req.authUser.sub } });
    if (!owned) throw NotFound('Vehicle not found');
    return prisma.vehicle.update({ where: { id }, data: body });
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const owned = await prisma.vehicle.findFirst({ where: { id, userId: req.authUser.sub } });
    if (!owned) throw NotFound('Vehicle not found');
    await prisma.vehicle.delete({ where: { id } });
    reply.code(204);
    return null;
  });
}
