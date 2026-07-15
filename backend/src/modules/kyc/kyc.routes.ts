import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getKyc, submitKyc, refreshKyc } from './kyc.service.js';

const submitBody = z.object({
  dateOfBirth: z.coerce.date(),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  city: z.string().min(1),
  postcode: z.string().min(2),
  country: z.string().length(2).optional(),
  nationality: z.string().optional(),
  documentType: z.enum(['PASSPORT', 'DRIVING_LICENCE', 'NATIONAL_ID']),
  documentNumber: z.string().min(3),
});

export default async function kycRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (req) => {
    const kyc = await getKyc(req.authUser.sub);
    return kyc ?? { status: 'NOT_STARTED' };
  });

  app.post('/', async (req) => {
    const body = submitBody.parse(req.body);
    return submitKyc({ userId: req.authUser.sub, ...body });
  });

  // Re-sync from the provider (manual review / webhook simulation).
  app.post('/refresh', async (req) => {
    return refreshKyc(req.authUser.sub);
  });
}
