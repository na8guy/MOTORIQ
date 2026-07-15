import { prisma } from '../../lib/prisma.js';
import { BadRequest, Conflict, NotFound } from '../../lib/errors.js';
import { wallester } from '../../integrations/wallester/wallester.client.js';
import type { TxnType } from '@prisma/client';

/**
 * Ensure the user has a wallet, provisioning a Wallester account for it
 * on first use.
 */
export async function ensureWallet(userId: string) {
  let wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    wallet = await prisma.wallet.create({ data: { userId } });
  }
  if (!wallet.wallesterAccountId) {
    const account = await wallester.createAccount({ externalId: `user_${userId}` });
    wallet = await prisma.wallet.update({
      where: { id: wallet.id },
      data: { wallesterAccountId: account.id, currency: account.currency },
    });
  }
  return wallet;
}

export async function getWallet(userId: string) {
  const wallet = await ensureWallet(userId);
  const transactions = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { wallet, transactions };
}

/**
 * Apply a balance-changing transaction atomically. `amountMinor` is
 * signed (credit positive, debit negative). `reference` gives
 * idempotency — a repeated reference is rejected.
 */
export async function applyTransaction(params: {
  userId: string;
  type: TxnType;
  amountMinor: number;
  description?: string;
  reference?: string;
}) {
  if (params.amountMinor === 0) throw BadRequest('Amount must be non-zero');
  const wallet = await ensureWallet(params.userId);

  if (params.reference) {
    const existing = await prisma.walletTransaction.findUnique({
      where: { reference: params.reference },
    });
    if (existing) throw Conflict('Duplicate transaction reference');
  }

  const newBalance = wallet.balanceMinor + params.amountMinor;
  if (newBalance < 0) throw BadRequest('Insufficient wallet balance');

  return prisma.$transaction(async (tx) => {
    const txn = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: params.type,
        amountMinor: params.amountMinor,
        currency: wallet.currency,
        description: params.description,
        reference: params.reference,
        status: 'COMPLETED',
      },
    });
    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: newBalance },
    });
    return { txn, wallet: updated };
  });
}

/**
 * Top up the wallet. In production this is called after a successful
 * payment authorisation; funds are loaded onto the Wallester account.
 */
export async function topUp(params: {
  userId: string;
  amountMinor: number;
  reference: string;
}) {
  if (params.amountMinor <= 0) throw BadRequest('Top-up amount must be positive');
  const wallet = await ensureWallet(params.userId);

  await wallester.topUp({
    accountId: wallet.wallesterAccountId!,
    amountMinor: params.amountMinor,
    reference: params.reference,
  });

  return applyTransaction({
    userId: params.userId,
    type: 'TOPUP',
    amountMinor: params.amountMinor,
    description: 'Wallet top-up',
    reference: params.reference,
  });
}

export async function spend(params: {
  userId: string;
  amountMinor: number;
  description: string;
  reference?: string;
}) {
  return applyTransaction({
    userId: params.userId,
    type: 'SPEND',
    amountMinor: -Math.abs(params.amountMinor),
    description: params.description,
    reference: params.reference,
  });
}

export async function assertWalletExists(userId: string) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) throw NotFound('Wallet not found');
  return wallet;
}
