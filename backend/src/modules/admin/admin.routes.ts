import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { Forbidden, NotFound } from '../../lib/errors.js';
import { notify } from '../notifications/notifications.service.js';
import { runDailyJobs } from '../../jobs/scheduler.js';
import { fuelFinder } from '../../integrations/fuelfinder/fuelfinder.client.js';
import { env } from '../../config/env.js';
import { TIERS, type Tier } from '../entitlements/entitlements.js';
import { grantPerksForPeriod } from '../subscriptions/perks.service.js';
import { applyMembershipChange } from '../subscriptions/subscription.service.js';
import { stripe } from '../../integrations/stripe/stripe.client.js';

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

  /**
   * Switch your own account to any tier, to see what members on that tier see.
   *
   * Recorded as `simulatedTier` rather than by changing `tier`, which matters:
   *   • the real membership and billing state are untouched, so exiting
   *     simulation restores exactly what was there before;
   *   • every response carries `simulated: true`, so a screenshot of "Pro" is
   *     never mistaken for a paying member;
   *   • it is set only behind requireAdmin, so a member cannot grant it to
   *     themselves — which would be free Pro for anyone who read the API.
   *
   * No email is sent: nothing was bought. Real upgrades email; testing doesn't.
   */
  app.post('/simulate-tier', async (req) => {
    const { tier } = z
      .object({ tier: z.enum(['FREE', 'PREMIUM', 'PRO']).nullable() })
      .parse(req.body);

    const user = await prisma.user.update({
      where: { id: req.authUser.sub },
      data: { simulatedTier: tier },
      select: { email: true, tier: true, simulatedTier: true },
    });

    // Give the simulated tier its perk allowances too, or the fuel-litre
    // balance would read zero and the tier wouldn't be properly testable.
    if (tier && tier !== 'FREE') {
      await grantPerksForPeriod(req.authUser.sub, tier as Tier);
    }

    console.log(
      tier
        ? `[admin] ${user.email} is now simulating ${tier} (real tier: ${user.tier})`
        : `[admin] ${user.email} stopped simulating; back to ${user.tier}`,
    );

    return {
      simulatedTier: user.simulatedTier,
      realTier: user.tier,
      message: tier
        ? `You are now seeing the app as a ${TIERS[tier as Tier].name} member. Your real membership is unchanged.`
        : `Simulation off — back to your real ${TIERS[user.tier as Tier].name} membership.`,
    };
  });

  /**
   * Change another member's tier by hand — a refund, a goodwill upgrade, or
   * fixing a payment that went wrong.
   *
   * Unlike simulation this is real, so it emails the member. Someone whose
   * membership changed must be told, especially if it was a downgrade.
   */
  app.post('/users/:id/tier', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { tier, notify: shouldNotify } = z
      .object({
        tier: z.enum(['FREE', 'PREMIUM', 'PRO']),
        notify: z.boolean().default(true),
      })
      .parse(req.body);

    const target = await prisma.user.findUnique({ where: { id }, select: { email: true, tier: true } });
    if (!target) throw NotFound('User not found');

    await applyMembershipChange({
      userId: id,
      tier: tier as Tier,
      reason: 'admin',
      silent: !shouldNotify,
    });

    console.log(`[admin] ${target.email}: ${target.tier} → ${tier} (manual, email ${shouldNotify ? 'sent' : 'suppressed'})`);
    return { ok: true, email: target.email, from: target.tier, to: tier, emailed: shouldNotify };
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
          ? 'Your SaveOnDrive account is fully verified — your wallet and card are ready.'
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
        tier: z.enum(['FREE', 'PREMIUM', 'PRO']).optional(),
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
