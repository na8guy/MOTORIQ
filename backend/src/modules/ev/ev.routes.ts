import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { rankedChargers } from './ev.service.js';

const rankedQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().max(100).default(15),
  limit: z.coerce.number().int().positive().max(10).default(3),
  /** Filter to rapid chargers only, e.g. minPowerKw=50. */
  minPowerKw: z.coerce.number().positive().max(400).optional(),
  /** Energy used to price a session — defaults to a typical 30 kWh top-up. */
  kwh: z.coerce.number().positive().max(200).optional(),
});

export default async function evRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Cheapest EV charging near a point, ranked like fuel: cheapest first, with
   * savings vs the local average. Sites that publish no price are included
   * below the priced ones (hasPrice=false) rather than hidden — see ev.service.
   */
  app.get('/ranked', async (req) => {
    const q = rankedQuery.parse(req.query);
    return rankedChargers({
      latitude: q.lat,
      longitude: q.lng,
      radiusKm: q.radiusKm,
      limit: q.limit,
      minPowerKw: q.minPowerKw,
      kwh: q.kwh,
    });
  });
}
