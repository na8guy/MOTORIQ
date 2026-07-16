import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { recordPurchase, savingsSummary, type Period } from './savings-engine.js';
import { generateSavingsInsight } from '../../integrations/ai/insights.js';
import type { FuelKind } from '../../integrations/fuelfinder/fuelfinder.client.js';
import {
  confirmPurchase,
  recordIntent,
} from '../savings/purchase-confirmation.service.js';
import { NotFound } from '../../lib/errors.js';

const fuelKinds = ['E10', 'E5', 'B7', 'SDV', 'ELECTRIC'] as const;

const intentBody = z.object({
  fuelKind: z.enum(fuelKinds),
  pricePencePerUnit: z.number().positive(),
  /** Local average when they set off — the benchmark the saving is measured against. */
  benchmarkPencePerUnit: z.number().positive().optional(),
  estimatedLitres: z.number().positive().max(200).optional(),
  vehicleId: z.string().optional(),
  siteId: z.string().optional(),
  stationBrand: z.string().optional(),
  stationPostcode: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

const confirmBody = z.object({
  filledUp: z.boolean().default(true),
  actualLitres: z.number().positive().max(200).optional(),
  actualPricePence: z.number().positive().optional(),
});

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
    const { status } = z
      .object({ status: z.enum(['PENDING', 'CONFIRMED', 'DECLINED', 'EXPIRED']).optional() })
      .parse(req.query);
    return prisma.fuelPurchase.findMany({
      where: { userId: req.authUser.sub, ...(status ? { status } : {}) },
      orderBy: { purchasedAt: 'desc' },
      take: 100,
    });
  });

  /**
   * Record that the member set off for a station ("Navigate here").
   *
   * This is an INTENT, not a purchase: it's stored PENDING and contributes
   * nothing to savings until a card transaction matches it or the member
   * confirms they filled up.
   */
  app.post('/intents', async (req, reply) => {
    const body = intentBody.parse(req.body);
    const intent = await recordIntent({
      userId: req.authUser.sub,
      vehicleId: body.vehicleId,
      fuelKind: body.fuelKind,
      pricePencePerUnit: body.pricePencePerUnit,
      benchmarkPencePerUnit: body.benchmarkPencePerUnit,
      estimatedLitres: body.estimatedLitres ?? 45,
      siteId: body.siteId,
      stationBrand: body.stationBrand,
      stationPostcode: body.stationPostcode,
      latitude: body.lat,
      longitude: body.lng,
    });
    reply.code(201);
    return intent;
  });

  /** Fill-ups awaiting a yes/no from the member. */
  app.get('/intents/pending', async (req) => {
    return prisma.fuelPurchase.findMany({
      where: { userId: req.authUser.sub, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  });

  /** "Did you fill up?" — yes (optionally correcting our estimate) or no. */
  app.post('/intents/:id/confirm', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = confirmBody.parse(req.body ?? {});
    const updated = await confirmPurchase(req.authUser.sub, id, {
      filledUp: body.filledUp,
      actualLitres: body.actualLitres,
      actualPricePence: body.actualPricePence,
    });
    if (!updated) throw NotFound('Purchase not found');
    return updated;
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
