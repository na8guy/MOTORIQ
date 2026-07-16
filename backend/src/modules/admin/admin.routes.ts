import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { Forbidden, NotFound } from '../../lib/errors.js';
import { notify } from '../notifications/notifications.service.js';
import { runDailyJobs } from '../../jobs/scheduler.js';
import { fuelFinder } from '../../integrations/fuelfinder/fuelfinder.client.js';
import { env } from '../../config/env.js';

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
    // CONFIRMED only — a pending intent is not a saving (see
    // savings/purchase-confirmation.service.ts).
    const savingsAgg = await prisma.fuelPurchase.aggregate({
      where: { status: 'CONFIRMED' },
      _sum: { savedMinor: true },
    });
    const pendingAgg = await prisma.fuelPurchase.aggregate({
      where: { status: 'PENDING' },
      _sum: { savedMinor: true },
      _count: true,
    });
    return {
      users,
      kyc: { verified, pending: pendingKyc },
      risk: { reviewQueue, blocked },
      cardsIssued: cards,
      transactions: txns,
      notificationsSent: notifications,
      walletFloatMinor: walletAgg._sum.balanceMinor ?? 0,
      totalMemberFuelSavedMinor: savingsAgg._sum.savedMinor ?? 0,
      // Intent recorded but not yet proven — deliberately reported separately
      // so this never inflates the headline figure.
      pendingConfirmation: {
        count: pendingAgg._count,
        potentialSavingMinor: pendingAgg._sum.savedMinor ?? 0,
      },
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

  /**
   * Which integrations are actually live, and which are quietly running on mock
   * data? An unset RESEND_API_KEY meant verification emails were never sent and
   * never appeared in Resend's logs — indistinguishable from a delivery problem
   * unless you read the server logs. This makes that visible.
   *
   * Reports only whether a secret is present, never its value.
   */
  app.get('/diagnostics', async () => {
    const configured = (v?: string): boolean => !!v && v.trim().length > 0;
    const fuel = await fuelFinder.status();

    return {
      email: {
        provider: 'resend',
        live: configured(env.RESEND_API_KEY),
        from: env.EMAIL_FROM,
        linkBase: process.env.RENDER_EXTERNAL_URL || env.APP_PUBLIC_URL || 'http://localhost:4000',
        note: configured(env.RESEND_API_KEY)
          ? 'Emails are being sent via Resend. If they do not arrive, check that EMAIL_FROM uses a domain verified in Resend.'
          : 'RESEND_API_KEY is NOT set — no email is sent and no request reaches Resend, which is why nothing appears in your Resend logs. Set RESEND_API_KEY in Render → Environment.',
      },
      fuel: {
        mode: fuel.mode,
        live: fuel.source === 'live',
        stationCount: fuel.stationCount,
        note:
          fuel.source === 'live'
            ? `Serving ${fuel.stationCount} real stations.`
            : 'Serving MOCK sample stations — members outside London will see no prices.',
      },
      vehicleData: {
        live: !env.DVLA_MOCK,
        vesConfigured: configured(env.DVLA_VES_API_KEY),
        motHistoryConfigured: configured(env.MOT_HISTORY_API_KEY),
        note: env.DVLA_MOCK
          ? 'DVLA_MOCK=true — MOT/tax dates are sample data, not real.'
          : 'Live DVLA/DVSA lookups.',
      },
      evCharging: {
        live: configured(env.OCM_API_KEY),
        note: configured(env.OCM_API_KEY)
          ? 'Live Open Charge Map data.'
          : 'OCM_API_KEY is not set — EV chargers are sample data. Get a free key at openchargemap.org.',
      },
      wallet: {
        live: !env.WALLESTER_MOCK,
        note: env.WALLESTER_MOCK ? 'WALLESTER_MOCK=true — cards/wallet are simulated.' : 'Live Wallester.',
      },
      ai: { live: configured(env.ANTHROPIC_API_KEY) },
      routing: { live: env.ROUTING_ENABLED, provider: env.OSRM_BASE_URL },
      auth: { requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION },
    };
  });

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
