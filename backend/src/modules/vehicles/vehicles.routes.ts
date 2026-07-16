import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { Conflict, NotFound } from '../../lib/errors.js';
import { dvla } from '../../integrations/dvla/dvla.client.js';
import { syncVehicle } from './vehicle-sync.service.js';

const fuelTypes = ['PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID', 'PLUGIN_HYBRID', 'LPG'] as const;

const createBody = z.object({
  registration: z.string().min(2).max(10).transform((s) => s.toUpperCase().replace(/\s+/g, '')),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  fuelType: z.enum(fuelTypes).default('PETROL'),
  mileage: z.number().int().min(0).optional(),
});

const updateBody = createBody.partial().extend({
  colour: z.string().optional(),
  // Member-entered: no public API publishes these (see dvla.client.ts).
  insuranceRenewalDate: z.coerce.date().optional().nullable(),
  serviceDueDate: z.coerce.date().optional().nullable(),
});

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

  /**
   * Preview what the government knows about a registration *before* adding it,
   * so the member can confirm "Ford Focus, blue, MOT expires 3 Mar" rather than
   * typing it all in. Read-only; does not create anything.
   */
  app.get('/lookup', async (req) => {
    const { registration } = z.object({ registration: z.string().min(2).max(10) }).parse(req.query);
    return dvla.lookup(registration);
  });

  app.post('/', async (req, reply) => {
    const body = createBody.parse(req.body);
    const dup = await prisma.vehicle.findFirst({
      where: { userId: req.authUser.sub, registration: body.registration },
    });
    if (dup) throw Conflict('You already have a vehicle with this registration');

    const created = await prisma.vehicle.create({
      data: { ...body, userId: req.authUser.sub },
    });

    // Fill in make/model/colour and raise MOT + tax reminders automatically.
    // The DVLA wins over anything the member guessed at on first add. A lookup
    // failure must not lose them the vehicle they just added — it's recorded on
    // dvlaSyncError and retried by the nightly refresh.
    try {
      const { vehicle } = await syncVehicle(created.id, { preferLookup: true });
      reply.code(201);
      return vehicle;
    } catch (err) {
      console.error(`[vehicles] sync on create failed for ${created.registration}:`, err);
      reply.code(201);
      return created;
    }
  });

  /** Re-pull DVLA/DVSA data on demand (pull-to-refresh in the app). */
  app.post('/:id/refresh', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const owned = await prisma.vehicle.findFirst({ where: { id, userId: req.authUser.sub } });
    if (!owned) throw NotFound('Vehicle not found');
    const { vehicle, lookup } = await syncVehicle(id, { preferLookup: true });
    return { vehicle, source: lookup.source, error: lookup.error ?? null };
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
