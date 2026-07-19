import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { wallester } from '../../integrations/wallester/wallester.client.js';
import { ensureWallet } from '../wallet/wallet.service.js';
import { requireVerifiedKyc } from '../kyc/kyc.service.js';
import { guard } from '../fraud/fraud.service.js';
import { requireFeature } from '../entitlements/entitlements.guard.js';

const statusBody = z.object({ status: z.enum(['ACTIVE', 'FROZEN', 'CLOSED']) });

export default async function cardsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);
  // The virtual fuel card is a paid perk — enforced here, not in the app.
  app.addHook('onRequest', requireFeature('card.virtual'));

  app.get('/', async (req) => {
    return prisma.card.findMany({
      where: { userId: req.authUser.sub },
      orderBy: { createdAt: 'desc' },
    });
  });

  // Issue a new SaveOnDrive Mastercard (virtual) linked to the user's wallet.
  app.post('/', async (req, reply) => {
    await requireVerifiedKyc(req.authUser.sub);
    await guard({ userId: req.authUser.sub, kind: 'CARD_ISSUE' });
    const wallet = await ensureWallet(req.authUser.sub);
    const user = await prisma.user.findUnique({ where: { id: req.authUser.sub } });
    const name =
      [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'SaveOnDrive Member';

    const issued = await wallester.issueVirtualCard({
      accountId: wallet.wallesterAccountId!,
      cardholderName: name,
      externalId: `card_${req.authUser.sub}_${Date.now()}`,
    });

    const card = await prisma.card.create({
      data: {
        userId: req.authUser.sub,
        wallesterCardId: issued.id,
        last4: issued.last4,
        brand: issued.brand,
        status: issued.status,
        virtual: true,
        expiryMonth: issued.expiryMonth,
        expiryYear: issued.expiryYear,
      },
    });
    reply.code(201);
    return card;
  });

  app.patch('/:id/status', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { status } = statusBody.parse(req.body);
    const card = await prisma.card.findFirst({ where: { id, userId: req.authUser.sub } });
    if (!card) throw NotFound('Card not found');

    if (card.wallesterCardId) {
      await wallester.setCardStatus(card.wallesterCardId, status);
    }
    return prisma.card.update({ where: { id }, data: { status } });
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const card = await prisma.card.findFirst({ where: { id, userId: req.authUser.sub } });
    if (!card) throw NotFound('Card not found');
    if (card.wallesterCardId) {
      await wallester.setCardStatus(card.wallesterCardId, 'CLOSED');
    }
    await prisma.card.delete({ where: { id } });
    reply.code(204);
    return null;
  });
}
