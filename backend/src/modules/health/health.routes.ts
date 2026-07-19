import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { requireFeature } from '../entitlements/entitlements.guard.js';
import { generateReport } from './health.service.js';

export default async function healthReportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);

  /**
   * Generate a fresh report for a vehicle. Pro — predictive maintenance is
   * part of what the top tier is for.
   */
  app.post(
    '/:vehicleId',
    { onRequest: [requireFeature('maintenance.predictive')] },
    async (req) => {
      const { vehicleId } = z.object({ vehicleId: z.string() }).parse(req.params);
      const report = await generateReport(req.authUser.sub, vehicleId);
      if (!report) throw NotFound('Vehicle not found');
      return report;
    },
  );

  /** Past reports, so a member can see whether things are improving. */
  app.get(
    '/:vehicleId',
    { onRequest: [requireFeature('maintenance.predictive')] },
    async (req) => {
      const { vehicleId } = z.object({ vehicleId: z.string() }).parse(req.params);
      const owned = await prisma.vehicle.findFirst({
        where: { id: vehicleId, userId: req.authUser.sub },
        select: { id: true },
      });
      if (!owned) throw NotFound('Vehicle not found');

      return prisma.vehicleHealthReport.findMany({
        where: { vehicleId, userId: req.authUser.sub },
        orderBy: { generatedAt: 'desc' },
        take: 12,
      });
    },
  );
}
