import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { recordPurchase, savingsSummary, type Period } from './savings-engine.js';
import { generateSavingsInsight } from '../../integrations/ai/insights.js';
import type { FuelKind } from '../../integrations/fuelfinder/fuelfinder.client.js';

const fuelKinds = ['E10', 'E5', 'B7', 'SDV', 'ELECTRIC'] as const;

const purchaseBody = z.object({
  fuelKind: z.enum(fuelKinds),
  litres: z.number().positive(),
  pricePencePerUnit: z.number().positive(),
  vehicleId: z.string().optional(),
  stationBrand: z.string().optional(),
  stationPostcode: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  purchasedAt: z.coerce.date().optional(),
});

const periodQuery = z.object({
  period: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),
});

export default async function insightsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);

  // Log a fuel purchase — feeds the savings engine.
  app.post('/purchases', async (req, reply) => {
    const body = purchaseBody.parse(req.body);
    const purchase = await recordPurchase({
      userId: req.authUser.sub,
      fuelKind: body.fuelKind as FuelKind,
      litres: body.litres,
      pricePencePerUnit: body.pricePencePerUnit,
      vehicleId: body.vehicleId,
      stationBrand: body.stationBrand,
      stationPostcode: body.stationPostcode,
      latitude: body.lat,
      longitude: body.lng,
      purchasedAt: body.purchasedAt,
    });
    reply.code(201);
    return purchase;
  });

  app.get('/purchases', async (req) => {
    return prisma.fuelPurchase.findMany({
      where: { userId: req.authUser.sub },
      orderBy: { purchasedAt: 'desc' },
      take: 100,
    });
  });

  // Deterministic savings rollup: daily / weekly / monthly + annual projection.
  app.get('/fuel-savings', async (req) => {
    const { period } = periodQuery.parse(req.query);
    return savingsSummary(req.authUser.sub, period as Period);
  });

  // AI-generated narrative + tips on top of the computed figures.
  app.get('/ai', async (req) => {
    const { period } = periodQuery.parse(req.query);
    const summary = await savingsSummary(req.authUser.sub, period as Period);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.authUser.sub },
      include: { subscription: true },
    });
    const displayName =
      [user.firstName, user.lastName].filter(Boolean).join(' ') || 'there';
    const insight = await generateSavingsInsight(summary, {
      displayName,
      monthlyDrivePackage: user.subscription?.mileagePackage ?? null,
    });
    return { summary, insight };
  });
}
