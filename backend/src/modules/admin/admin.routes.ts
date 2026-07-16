import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { Forbidden, NotFound } from '../../lib/errors.js';
import { notify } from '../notifications/notifications.service.js';
import { runDailyJobs } from '../../jobs/scheduler.js';
import { fuelFinder } from '../../integrations/fuelfinder/fuelfinder.client.js';

/** Guard: the caller must be an ADMIN. */
async function requireAdmin(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: req.authUser.sub } });
  if (!user || user.role !== 'ADMIN') throw Forbidden('Admin access required');
}

export default async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', requireAdmin);

  // ── Ops dashboard stats ──
  app.get('/stats', async () => {
    const [users, verified, pendingKyc, reviewQueue, blocked, cards, txns, notifications] =
      await Promise.all([
        prisma.user.count(),
        prisma.kycProfile.count({ where: { status: 'VERIFIED' } }),
        prisma.kycProfile.count({ where: { status: 'PENDING' } }),
        prisma.riskEvent.count({ where: { decision: 'REVIEW' } }),
        prisma.riskEvent.count({ where: { decision: 'BLOCK' } }),
        prisma.card.count(),
        prisma.walletTransaction.count(),
        prisma.notification.count(),
      ]);
    const walletAgg = await prisma.wallet.aggregate({ _sum: { balanceMinor: true } });
    const savingsAgg = await prisma.fuelPurchase.aggregate({ _sum: { savedMinor: true } });
    return {
      users,
      kyc: { verified, pending: pendingKyc },
      risk: { reviewQueue, blocked },
      cardsIssued: cards,
      transactions: txns,
      notificationsSent: notifications,
      walletFloatMinor: walletAgg._sum.balanceMinor ?? 0,
      totalMemberFuelSavedMinor: savingsAgg._sum.savedMinor ?? 0,
    };
  });

  /**
   * Force the daily run now (DVLA refresh + due-reminder notifications).
   * Also the endpoint to point Render Cron at, since the in-process timer only
   * fires while the service is awake — see jobs/scheduler.ts.
   */
  app.post('/jobs/daily', async () => runDailyJobs());

  /** Is fuel price data live or falling back to samples? */
  app.get('/fuel/status', async () => fuelFinder.status());

  // ── Users ──
  app.get('/users', async (req) => {
    const { q, limit } = z
      .object({ q: z.string().optional(), limit: z.coerce.number().max(200).default(50) })
      .parse(req.query);
    return prisma.user.findMany({
      where: q ? { email: { contains: q, mode: 'insensitive' } } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        tier: true,
        role: true,
        emailVerified: true,
        createdAt: true,
        kyc: { select: { status: true, riskLevel: true } },
        wallet: { select: { balanceMinor: true } },
      },
    });
  });

  // ── Fraud review queue ──
  app.get('/risk/queue', async () => {
    return prisma.riskEvent.findMany({
      where: { decision: 'REVIEW' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { email: true } } },
    });
  });

  // Approve or block a flagged event. Approving marks it ALLOW; blocking
  // marks it BLOCK and notifies the member.
  app.post('/risk/:id/decision', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { decision } = z.object({ decision: z.enum(['ALLOW', 'BLOCK']) }).parse(req.body);
    const event = await prisma.riskEvent.findUnique({ where: { id } });
    if (!event) throw NotFound('Risk event not found');
    const updated = await prisma.riskEvent.update({ where: { id }, data: { decision } });
    if (decision === 'BLOCK') {
      await notify(event.userId, {
        title: 'Security review',
        body: 'A recent transaction was blocked after review. Please contact support.',
        type: 'RISK',
      });
    }
    return updated;
  });

  // ── KYC review ──
  app.get('/kyc/pending', async () => {
    return prisma.kycProfile.findMany({
      where: { status: 'PENDING' },
      orderBy: { submittedAt: 'asc' },
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
    });
  });

  app.post('/kyc/:userId/decision', async (req) => {
    const { userId } = z.object({ userId: z.string() }).parse(req.params);
    const { decision, reason } = z
      .object({ decision: z.enum(['VERIFIED', 'REJECTED']), reason: z.string().optional() })
      .parse(req.body);
    const profile = await prisma.kycProfile.update({
      where: { userId },
      data: {
        status: decision,
        rejectionReason: decision === 'REJECTED' ? (reason ?? 'Manual review') : null,
        verifiedAt: decision === 'VERIFIED' ? new Date() : null,
      },
    });
    await notify(userId, {
      title: decision === 'VERIFIED' ? 'Identity verified' : 'Identity check failed',
      body:
        decision === 'VERIFIED'
          ? 'Your MOTORIQ account is fully verified — your wallet and card are ready.'
          : `We couldn't verify your identity${reason ? `: ${reason}` : ''}.`,
      type: 'KYC',
    });
    return profile;
  });

  // ── Broadcast a marketing/ops notification ──
  app.post('/broadcast', async (req) => {
    const { title, body, tier } = z
      .object({
        title: z.string().min(1),
        body: z.string().min(1),
        tier: z.enum(['FREE', 'PLUS', 'DRIVE', 'DRIVE_PLUS']).optional(),
      })
      .parse(req.body);
    const users = await prisma.user.findMany({
      where: tier ? { tier } : {},
      select: { id: true },
    });
    await Promise.all(users.map((u) => notify(u.id, { title, body, type: 'MARKETING' })));
    return { sent: users.length };
  });
}
