import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireFeature } from '../entitlements/entitlements.guard.js';
import { renewalGuidance } from './insurance.service.js';
import { offersFor } from '../affiliate/affiliate.service.js';
import { awin } from '../../integrations/affiliate/awin.client.js';

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

    // Tracked affiliate links to the comparison sites. This is the one place
    // the affiliate model genuinely beats a direct partnership: we are not
    // FCA-authorised and cannot quote premiums, but the aggregators are — so
    // handing off with a tracked link is both the legal route and the only one
    // that earns.
    const offers = await offersFor(req.authUser.sub, 'INSURANCE');

    return {
      vehicles: guidance,
      offers,
      disclaimer:
        'SaveOnDrive is not an insurance broker and does not provide quotes. These are ' +
        'reminders and published industry averages to help you shop at the right time.',
      // Required by the CAP Code — a paid link must be identifiable as one.
      affiliateDisclosure: awin.isLive
        ? 'We may earn a commission if you buy through these links. It never changes ' +
          'what you pay.'
        : null,
    };
  });
}
