import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { stripe } from '../../integrations/stripe/stripe.client.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { entitlementFor } from '../entitlements/entitlements.guard.js';
import {
  annualPerkCostMinor,
  TIER_ORDER,
  TIERS,
  type BillingPeriod,
  type Tier,
} from '../entitlements/entitlements.js';
import { perkBalances } from './perks.service.js';
import { applyMembershipChange } from './subscription.service.js';

const checkoutBody = z.object({
  tier: z.enum(['PREMIUM', 'PRO']),
  period: z.enum(['MONTHLY', 'ANNUAL']).default('MONTHLY'),
});

export default async function subscriptionsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * The pricing screen's data. Public — someone should be able to see what a
   * membership costs before creating an account.
   *
   * Served from entitlements.ts, so the app can never advertise a feature the
   * paywall won't honour.
   */
  app.get('/plans', async () => ({
    plans: TIER_ORDER.map((tier) => {
      const def = TIERS[tier];
      return {
        tier,
        name: def.name,
        tagline: def.tagline,
        monthlyMinor: def.monthlyMinor,
        annualMinor: def.annualMinor,
        // Show the saving rather than making people do the sum.
        annualSavingMinor: Math.max(0, def.monthlyMinor * 12 - def.annualMinor),
        highlights: def.highlights,
        features: def.features,
        perks: def.perks,
      };
    }),
  }));

  app.register(async (secured) => {
    secured.addHook('onRequest', app.authenticate);

    /** The member's own membership: tier, status, perks left this period. */
    secured.get('/me', async (req) => {
      const userId = req.authUser.sub;
      const [ent, sub, balances] = await Promise.all([
        entitlementFor(userId),
        prisma.subscription.findUnique({ where: { userId } }),
        perkBalances(userId),
      ]);

      return {
        tier: ent.tier,
        active: ent.active,
        /** True when an admin is testing this tier rather than paying for it. */
        simulated: ent.simulated,
        features: ent.features,
        perks: TIERS[ent.tier].perks,
        balances,
        subscription: sub
          ? {
              status: sub.status,
              billingPeriod: sub.billingPeriod,
              priceMinor: sub.priceMinor,
              currentPeriodEnd: sub.currentPeriodEnd,
              cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
              renewsAt: sub.renewsAt,
            }
          : null,
      };
    });

    /**
     * Start checkout for a paid tier.
     *
     * Returns a Stripe URL for the app to open. Note what this does NOT do: it
     * does not change the member's tier. That happens only when Stripe's
     * webhook confirms payment — otherwise anyone could call this endpoint and
     * hand themselves Pro without paying.
     */
    secured.post('/checkout', async (req) => {
      const { tier, period } = checkoutBody.parse(req.body);
      const userId = req.authUser.sub;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true, lastName: true, stripeCustomerId: true, tier: true },
      });
      if (!user) throw NotFound('Account not found');
      if (user.tier === tier) throw BadRequest(`You are already on ${TIERS[tier as Tier].name}`);

      const customerId = await stripe.ensureCustomer({
        userId,
        email: user.email,
        name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
        existingCustomerId: user.stripeCustomerId,
      });
      if (customerId !== user.stripeCustomerId) {
        await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
      }

      const session = await stripe.createCheckout({
        userId,
        customerId,
        tier: tier as Exclude<Tier, 'FREE'>,
        period: period as BillingPeriod,
        successUrl: env.STRIPE_SUCCESS_URL,
        cancelUrl: env.STRIPE_CANCEL_URL,
      });

      return {
        checkoutUrl: session.url,
        sessionId: session.id,
        live: session.live,
        // The app shows a banner when nothing will actually be charged, so a
        // test upgrade is never mistaken for a real one.
        note: session.live
          ? null
          : 'Stripe is not configured — this is a test checkout and no payment will be taken.',
      };
    });

    /**
     * Confirm a MOCK checkout. Only works while Stripe is unconfigured.
     *
     * With Stripe live this refuses outright: granting a tier on the app's
     * say-so is exactly the bypass the webhook exists to prevent.
     */
    secured.post('/checkout/mock-confirm', async (req) => {
      if (stripe.isLive) {
        throw BadRequest('Stripe is live — memberships are granted by webhook, not by the app');
      }
      const { tier, period } = checkoutBody.parse(req.body);
      await applyMembershipChange({
        userId: req.authUser.sub,
        tier: tier as Tier,
        period: period as BillingPeriod,
        reason: 'checkout',
      });
      return { ok: true, tier, mock: true };
    });

    /** Stripe's billing portal — change card, download invoices, cancel. */
    secured.post('/portal', async (req) => {
      const user = await prisma.user.findUnique({
        where: { id: req.authUser.sub },
        select: { stripeCustomerId: true },
      });
      if (!user?.stripeCustomerId) throw BadRequest('No billing account yet — upgrade first');
      const url = await stripe.createPortalSession(user.stripeCustomerId, env.STRIPE_SUCCESS_URL);
      return { portalUrl: url };
    });

    /**
     * Cancel. Deliberately at period end, never immediately — they paid for
     * the rest of the month and should keep it.
     */
    secured.post('/cancel', async (req) => {
      const userId = req.authUser.sub;
      const sub = await prisma.subscription.findUnique({ where: { userId } });
      if (!sub || sub.plan === 'FREE') throw BadRequest('You do not have a paid membership');

      if (sub.stripeSubscriptionId && stripe.isLive) {
        await stripe.cancelAtPeriodEnd(sub.stripeSubscriptionId);
        // Don't downgrade here — Stripe's webhook does that when the period ends.
        await prisma.subscription.update({
          where: { userId },
          data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
        });
      } else {
        await applyMembershipChange({ userId, tier: 'FREE', reason: 'cancelled' });
      }

      return {
        ok: true,
        message: sub.currentPeriodEnd
          ? `Your membership stays active until ${sub.currentPeriodEnd.toISOString().slice(0, 10)}.`
          : 'Your membership has been cancelled.',
      };
    });

    /** Undo a scheduled cancellation. */
    secured.post('/resume', async (req) => {
      const sub = await prisma.subscription.findUnique({ where: { userId: req.authUser.sub } });
      if (!sub?.cancelAtPeriodEnd) throw BadRequest('Nothing to resume');
      if (sub.stripeSubscriptionId && stripe.isLive) {
        await stripe.resumeSubscription(sub.stripeSubscriptionId);
      }
      await prisma.subscription.update({
        where: { userId: req.authUser.sub },
        data: { cancelAtPeriodEnd: false, cancelledAt: null },
      });
      return { ok: true };
    });

    /**
     * What each tier actually costs us to deliver. Admin-only; keeps the
     * pricing conversation grounded in arithmetic rather than optimism.
     */
    secured.get('/economics', async (req) => {
      const user = await prisma.user.findUnique({
        where: { id: req.authUser.sub },
        select: { role: true },
      });
      if (user?.role !== 'ADMIN') throw NotFound('Not found');
      return TIER_ORDER.map((tier) => {
        const def = TIERS[tier];
        const cost = annualPerkCostMinor(tier);
        const annualRevenue = def.monthlyMinor * 12;
        return {
          tier,
          monthlyMinor: def.monthlyMinor,
          annualMinor: def.annualMinor,
          annualPerkCostMinor: cost,
          marginMonthlyPct: annualRevenue
            ? Math.round(((annualRevenue - cost) / annualRevenue) * 1000) / 10
            : null,
          marginAnnualPct: def.annualMinor
            ? Math.round(((def.annualMinor - cost) / def.annualMinor) * 1000) / 10
            : null,
        };
      });
    });
  });
}
