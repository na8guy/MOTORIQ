import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { requireFeature } from '../entitlements/entitlements.guard.js';
import { checkLocation, checkRoute, ZONES } from './zones.service.js';

const coord = {
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
};

export default async function zonesRoutes(app: FastifyInstance): Promise<void> {
  /** The zones we know about. Public — useful before anyone signs up. */
  app.get('/', async () => ({
    zones: ZONES.map((z) => ({
      id: z.id,
      name: z.name,
      kind: z.kind,
      operator: z.operator,
      dailyChargeMinor: z.dailyChargeMinor,
      hours: z.hours,
      exemption: z.exemption,
      checkUrl: z.checkUrl,
      verified: z.verified,
    })),
    // Say plainly what this is and isn't, so nobody treats it as the last word
    // when the penalty for being wrong is £180.
    disclaimer:
      'Zone boundaries are approximate and charges change. Always confirm with the ' +
      'operator before you drive — we link to each one.',
  }));

  app.register(async (secured) => {
    secured.addHook('onRequest', app.authenticate);

    /**
     * Am I in a charging zone right now, and would my car be charged?
     * Premium — this is one of the concrete reasons to pay.
     */
    secured.get(
      '/check',
      { onRequest: [requireFeature('ulez.checker')] },
      async (req) => {
        const q = z
          .object({ ...coord, vehicleId: z.string().optional() })
          .parse(req.query);

        const vehicle = q.vehicleId
          ? await prisma.vehicle.findFirst({
              where: { id: q.vehicleId, userId: req.authUser.sub },
              select: { fuelType: true, year: true, registration: true },
            })
          : // No vehicle named — use their first, since most members have one.
            await prisma.vehicle.findFirst({
              where: { userId: req.authUser.sub },
              orderBy: { createdAt: 'asc' },
              select: { fuelType: true, year: true, registration: true },
            });

        const checks = checkLocation({
          latitude: q.lat,
          longitude: q.lng,
          vehicle: vehicle ?? undefined,
        });

        return {
          vehicle: vehicle
            ? { registration: vehicle.registration, fuelType: vehicle.fuelType, year: vehicle.year }
            : null,
          inZone: checks.some((c) => c.inside),
          checks,
          note: vehicle
            ? null
            : 'Add a vehicle and we can tell you whether you would actually be charged.',
        };
      },
    );

    /** What would this journey cost in zone charges? */
    secured.get(
      '/route',
      { onRequest: [requireFeature('ulez.checker')] },
      async (req) => {
        const q = z
          .object({
            fromLat: coord.lat,
            fromLng: coord.lng,
            toLat: coord.lat,
            toLng: coord.lng,
            vehicleId: z.string().optional(),
          })
          .parse(req.query);

        const vehicle = await prisma.vehicle.findFirst({
          where: {
            userId: req.authUser.sub,
            ...(q.vehicleId ? { id: q.vehicleId } : {}),
          },
          orderBy: { createdAt: 'asc' },
          select: { fuelType: true, year: true, registration: true },
        });

        const result = checkRoute({
          from: { latitude: q.fromLat, longitude: q.fromLng },
          to: { latitude: q.toLat, longitude: q.toLng },
          vehicle: vehicle ?? undefined,
        });

        return {
          ...result,
          vehicle: vehicle
            ? { registration: vehicle.registration, fuelType: vehicle.fuelType, year: vehicle.year }
            : null,
          note: 'Zones are sampled along a straight line, so treat this as a heads-up rather than a bill.',
        };
      },
    );
  });
}
