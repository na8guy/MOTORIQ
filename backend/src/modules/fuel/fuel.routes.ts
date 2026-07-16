import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fuelFinder, type FuelKind } from '../../integrations/fuelfinder/fuelfinder.client.js';
import { queryBool } from '../../lib/zod.js';

const kinds = ['E10', 'E5', 'B7', 'SDV', 'ELECTRIC'] as const;

const nearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().max(100).optional(),
  evOnly: queryBool,
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const cheapestQuery = nearbyQuery
  .pick({ lat: true, lng: true, radiusKm: true })
  .extend({ kind: z.enum(kinds) });

const rankedQuery = cheapestQuery.extend({
  limit: z.coerce.number().int().positive().max(10).default(3),
  tankLitres: z.coerce.number().positive().max(200).optional(),
});

export default async function fuelRoutes(app: FastifyInstance): Promise<void> {
  // Fuel/EV price lookups. Public — powers the free tier.
  app.get('/stations', async (req) => {
    const q = nearbyQuery.parse(req.query);
    return fuelFinder.nearby({
      latitude: q.lat,
      longitude: q.lng,
      radiusKm: q.radiusKm,
      evOnly: q.evOnly,
      limit: q.limit,
    });
  });

  app.get('/cheapest', async (req) => {
    const q = cheapestQuery.parse(req.query);
    const station = await fuelFinder.cheapest({
      latitude: q.lat,
      longitude: q.lng,
      kind: q.kind as FuelKind,
      radiusKm: q.radiusKm,
    });
    return { kind: q.kind, station };
  });

  // Ranked cheapest stations (default top 3) with per-station savings vs the
  // local average, extra-vs-cheapest, and a maps navigation URL.
  app.get('/ranked', async (req) => {
    const q = rankedQuery.parse(req.query);
    return fuelFinder.ranked({
      latitude: q.lat,
      longitude: q.lng,
      kind: q.kind as FuelKind,
      radiusKm: q.radiusKm,
      limit: q.limit,
      tankLitres: q.tankLitres,
    });
  });

  // EV convenience endpoint — chargers only.
  app.get('/ev/stations', async (req) => {
    const q = nearbyQuery.pick({ lat: true, lng: true, radiusKm: true, limit: true }).parse(req.query);
    return fuelFinder.nearby({
      latitude: q.lat,
      longitude: q.lng,
      radiusKm: q.radiusKm,
      evOnly: true,
      limit: q.limit,
    });
  });
}
