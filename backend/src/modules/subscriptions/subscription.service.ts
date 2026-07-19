import type { BillingPeriod as DbPeriod, SubPlan, SubStatus } from '@prisma/client';
import { env } from '../../config/env.js';
import { membershipChangedEmail, sendEmail } from '../../integrations/email/resend.js';
import { stripe } from '../../integrations/stripe/stripe.client.js';
import { prisma } from '../../lib/prisma.js';
import { notify } from '../notifications/notifications.service.js';
import { TIERS, priceMinor, type BillingPeriod, type Tier } from '../entitlements/entitlements.js';
import { grantPerksForPeriod } from './perks.service.js';

/**
 * Membership state, driven by Stripe.
 *
 * The rule this module exists to enforce: a member's tier changes when STRIPE
 * says money moved, not when the app says checkout finished. The app's success
 * redirect is a UX convenience — it can be replayed, faked, or simply never
 * reached if someone closes the tab after paying. Only a signed webhook is
 * trusted to grant a paid tier.
 */

/** Map Stripe's subscription status onto ours. */
function mapStatus(stripeStatus: string): SubStatus {
  switch (stripeStatus) {
    case 'active':
      return 'ACTIVE';
    case 'trialing':
      return 'TRIALING';
    case 'past_due':
      return 'PAST_DUE';
    case 'canceled':
      return 'CANCELLED';
    case 'unpaid':
      return 'UNPAID';
    default:
      return 'INCOMPLETE';
  }
}

/**
 * Apply a tier change and tell the member.
 *
 * `reason` is recorded and shapes the email: an upgrade someone paid for reads
 * differently from a downgrade caused by a failed card, and a member who is
 * losing access deserves to know exactly why and what to do about it.
 */
export async function applyMembershipChange(params: {
  userId: string;
  tier: Tier;
  period?: BillingPeriod;
  status?: SubStatus;
  reason: 'checkout' | 'renewal' | 'cancelled' | 'payment_failed' | 'admin' | 'expired';
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  /** Suppress the email — used when an admin is only simulating a tier. */
  silent?: boolean;
}): Promise<void> {
  const before = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { tier: true, email: true, firstName: true },
  });
  if (!before) return;

  const status = params.status ?? 'ACTIVE';
  const period = params.period ?? 'MONTHLY';

  await prisma.$transaction([
    prisma.user.update({ where: { id: params.userId }, data: { tier: params.tier } }),
    prisma.subscription.upsert({
      where: { userId: params.userId },
      create: {
        userId: params.userId,
        plan: params.tier as SubPlan,
        status,
        billingPeriod: period as DbPeriod,
        priceMinor: priceMinor(params.tier, period),
        stripeSubscriptionId: params.stripeSubscriptionId ?? null,
        currentPeriodEnd: params.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
        renewsAt: params.currentPeriodEnd ?? null,
        cancelledAt: params.reason === 'cancelled' ? new Date() : null,
      },
      update: {
        plan: params.tier as SubPlan,
        status,
        billingPeriod: period as DbPeriod,
        priceMinor: priceMinor(params.tier, period),
        ...(params.stripeSubscriptionId ? { stripeSubscriptionId: params.stripeSubscriptionId } : {}),
        currentPeriodEnd: params.currentPeriodEnd ?? undefined,
        cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? undefined,
        renewsAt: params.currentPeriodEnd ?? undefined,
        cancelledAt: params.reason === 'cancelled' ? new Date() : null,
      },
    }),
  ]);

  // Paid tiers get their allowance the moment they become active. Doing this
  // on activation rather than lazily means the member sees their litres
  // immediately instead of wondering where the perk went.
  if (params.tier !== 'FREE' && (status === 'ACTIVE' || status === 'TRIALING')) {
    await grantPerksForPeriod(params.userId, params.tier).catch((err) =>
      console.error('[subscription] perk grant failed:', err),
    );
  }

  const changed = before.tier !== params.tier;
  if (!changed || params.silent) return;

  await notify(params.userId, {
    title: params.tier === 'FREE' ? 'Membership ended' : `Welcome to ${TIERS[params.tier].name}`,
    body:
      params.tier === 'FREE'
        ? 'Your paid membership has ended. Your free features are still here.'
        : `${TIERS[params.tier].name} is active — your perks are ready.`,
    type: 'MEMBERSHIP',
  });

  try {
    const email = membershipChangedEmail({
      name: before.firstName ?? 'there',
      fromTier: TIERS[before.tier as Tier].name,
      toTier: TIERS[params.tier].name,
      reason: params.reason,
      highlights: TIERS[params.tier].highlights,
      perks: TIERS[params.tier].perks,
      manageUrl: `${env.APP_PUBLIC_URL || 'https://saveondrive.co.uk'}/account`,
    });
    const res = await sendEmail({ to: before.email, ...email });
    console.log(
      res.sent
        ? `[membership] ${before.tier} → ${params.tier} email sent to ${before.email}`
        : `[membership] ${before.tier} → ${params.tier} email NOT sent (RESEND_API_KEY unset)`,
    );
  } catch (err) {
    // Never let a mail failure roll back a membership the member paid for.
    console.error('[membership] email failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Handle a verified Stripe webhook.
 *
 * Only called after the signature has been checked — see stripe.routes.ts.
 * Unknown event types are acknowledged and ignored: returning an error would
 * make Stripe retry forever for events we never asked for.
 */
export async function handleStripeEvent(event: {
  type: string;
  data: { object: Record<string, unknown> };
}): Promise<{ handled: boolean }> {
  const obj = event.data.object;

  switch (event.type) {
    // Money has actually moved: this is the event that grants a paid tier.
    case 'checkout.session.completed': {
      const meta = (obj.metadata ?? {}) as Record<string, string>;
      const userId = meta.userId;
      const tier = meta.tier as Tier | undefined;
      if (!userId || !tier) {
        console.warn('[stripe] checkout.session.completed without userId/tier metadata');
        return { handled: false };
      }
      const subId = typeof obj.subscription === 'string' ? obj.subscription : null;
      const sub = subId ? await stripe.getSubscription(subId) : null;

      await applyMembershipChange({
        userId,
        tier,
        period: (meta.period as BillingPeriod) ?? 'MONTHLY',
        status: sub ? mapStatus(sub.status) : 'ACTIVE',
        reason: 'checkout',
        stripeSubscriptionId: subId,
        currentPeriodEnd: periodEnd(sub),
      });
      return { handled: true };
    }

    // Renewal, plan change, cancellation scheduled, or payment recovered.
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const meta = (obj.metadata ?? {}) as Record<string, string>;
      const userId = meta.userId ?? (await userIdFromSubscription(obj.id as string));
      if (!userId) return { handled: false };

      const status = mapStatus(String(obj.status));
      const cancelAtEnd = obj.cancel_at_period_end === true;
      // A past-due or unpaid subscription keeps its tier for now — the
      // entitlement guard decides whether it still grants access, so a card
      // that expires mid-month doesn't instantly strip breakdown cover.
      await applyMembershipChange({
        userId,
        tier: (meta.tier as Tier) ?? (await currentTier(userId)),
        period: (meta.period as BillingPeriod) ?? 'MONTHLY',
        status,
        reason: cancelAtEnd ? 'cancelled' : 'renewal',
        stripeSubscriptionId: String(obj.id),
        currentPeriodEnd: periodEndFromRaw(obj),
        cancelAtPeriodEnd: cancelAtEnd,
      });
      return { handled: true };
    }

    // The subscription is properly over.
    case 'customer.subscription.deleted': {
      const meta = (obj.metadata ?? {}) as Record<string, string>;
      const userId = meta.userId ?? (await userIdFromSubscription(obj.id as string));
      if (!userId) return { handled: false };
      await applyMembershipChange({
        userId,
        tier: 'FREE',
        status: 'CANCELLED',
        reason: 'expired',
        stripeSubscriptionId: String(obj.id),
        currentPeriodEnd: periodEndFromRaw(obj),
      });
      return { handled: true };
    }

    // Card failed. Don't downgrade yet — Stripe retries for days, and yanking
    // someone's cover the hour their card expires is a poor way to treat a
    // paying member. Tell them so they can fix it.
    case 'invoice.payment_failed': {
      const subId = typeof obj.subscription === 'string' ? obj.subscription : null;
      const userId = subId ? await userIdFromSubscription(subId) : null;
      if (!userId) return { handled: false };
      await prisma.subscription.updateMany({
        where: { userId },
        data: { status: 'PAST_DUE' },
      });
      await notify(userId, {
        title: 'Payment failed',
        body: 'We could not take your membership payment. Update your card to keep your perks.',
        type: 'MEMBERSHIP',
      });
      return { handled: true };
    }

    default:
      return { handled: false };
  }
}

function periodEnd(sub: { items?: { data?: { current_period_end?: number }[] } } | null): Date | null {
  const ts = sub?.items?.data?.[0]?.current_period_end;
  return ts ? new Date(ts * 1000) : null;
}

function periodEndFromRaw(obj: Record<string, unknown>): Date | null {
  // Stripe moved current_period_end onto subscription items; support both.
  const direct = obj.current_period_end;
  if (typeof direct === 'number') return new Date(direct * 1000);
  const items = obj.items as { data?: { current_period_end?: number }[] } | undefined;
  const ts = items?.data?.[0]?.current_period_end;
  return ts ? new Date(ts * 1000) : null;
}

async function userIdFromSubscription(stripeSubscriptionId: string): Promise<string | null> {
  const row = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId },
    select: { userId: true },
  });
  return row?.userId ?? null;
}

async function currentTier(userId: string): Promise<Tier> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } });
  return (u?.tier as Tier) ?? 'FREE';
}
