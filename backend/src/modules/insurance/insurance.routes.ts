import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireFeature } from '../entitlements/entitlements.guard.js';
import { renewalGuidance } from './insurance.service.js';

export default async function insuranceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);

  /**
   * Renewal guidance for the member's vehicles. Pro.
   *
   * Guidance, not quotes — see insurance.service.ts for why we don't pretend
   * to price insurance without FCA authorisation.
   */
  app.get('/renewal', { onRequest: [requireFeature('insurance.optimizer')] }, async (req) => {
    const { vehicleId } = z.object({ vehicleId: z.string().optional() }).parse(req.query);
    const guidance = await renewalGuidance(req.authUser.sub, vehicleId);
    return {
      vehicles: guidance,
      disclaimer:
        'SaveOnDrive is not an insurance broker and does not provide quotes. These are ' +
        'reminders and published industry averages to help you shop at the right time.',
    };
  });
}
