import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { getWallet, topUp, spend } from './wallet.service.js';

const amountBody = z.object({
  // Amount in major units (pounds). Converted to pence internally.
  amount: z.number().positive(),
  description: z.string().optional(),
  reference: z.string().optional(),
});

export default async function walletRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (req) => {
    const { wallet, transactions } = await getWallet(req.authUser.sub);
    return {
      id: wallet.id,
      balanceMinor: wallet.balanceMinor,
      currency: wallet.currency,
      wallesterAccountId: wallet.wallesterAccountId,
      transactions,
    };
  });

  app.get('/transactions', async (req) => {
    const { transactions } = await getWallet(req.authUser.sub);
    return transactions;
  });

  app.post('/topup', async (req) => {
    const body = amountBody.parse(req.body);
    const result = await topUp({
      userId: req.authUser.sub,
      amountMinor: Math.round(body.amount * 100),
      reference: body.reference ?? `topup_${crypto.randomUUID()}`,
    });
    return { balanceMinor: result.wallet.balanceMinor, transaction: result.txn };
  });

  app.post('/spend', async (req) => {
    const body = amountBody.parse(req.body);
    const result = await spend({
      userId: req.authUser.sub,
      amountMinor: Math.round(body.amount * 100),
      description: body.description ?? 'Purchase',
      reference: body.reference,
    });
    return { balanceMinor: result.wallet.balanceMinor, transaction: result.txn };
  });
}
