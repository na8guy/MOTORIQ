import Stripe from 'stripe';
import { env } from '../../config/env.js';
import { priceMinor, TIERS, type BillingPeriod, type Tier } from '../../modules/entitlements/entitlements.js';

/**
 * Stripe — subscription billing for Premium and Pro.
 *
 * Design rules that matter here:
 *
 *  • STRIPE IS THE SOURCE OF TRUTH FOR PAYMENT. We never mark a member as paid
 *    because the app said checkout finished — the app can be lied to, and a
 *    redirect can be replayed. The tier changes only when a signed webhook
 *    tells us money actually moved.
 *
 *  • Prices are read from entitlements.ts, not hardcoded in the dashboard, so
 *    the pricing screen, the paywall and the charge can never disagree.
 *
 *  • Without STRIPE_SECRET_KEY the client runs in mock mode: checkout returns a
 *    fake URL and nothing is charged. That keeps the whole upgrade flow
 *    testable before the account exists, and is reported by /admin/diagnostics
 *    so mock mode can never be mistaken for live.
 */

export interface CheckoutSession {
  id: string;
  url: string;
  /** False when this is a mock session and no money will move. */
  live: boolean;
}

class StripeClient {
  private client: Stripe | null = null;

  get isLive(): boolean {
    return !!env.STRIPE_SECRET_KEY;
  }

  private get stripe(): Stripe {
    if (!this.client) {
      if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
      this.client = new Stripe(env.STRIPE_SECRET_KEY, {
        // Pin the version: Stripe changes response shapes between versions, and
        // an unpinned client can start failing after an account-level upgrade.
        // Pinned to the version this SDK ships with. Bumping the SDK may
        // require changing this string — that is the point of pinning.
        apiVersion: '2026-06-24.dahlia',
        appInfo: { name: 'SaveOnDrive', version: '1.0.0' },
      });
    }
    return this.client;
  }

  /** Find or create the Stripe customer for a member. */
  async ensureCustomer(params: {
    userId: string;
    email: string;
    name?: string | null;
    existingCustomerId?: string | null;
  }): Promise<string> {
    if (params.existingCustomerId) return params.existingCustomerId;
    if (!this.isLive) return `cus_mock_${params.userId.slice(0, 12)}`;

    const customer = await this.stripe.customers.create({
      email: params.email,
      name: params.name ?? undefined,
      // The member id travels with every Stripe object, so a webhook can always
      // find its way home even if our own ids are missing from the event.
      metadata: { userId: params.userId },
    });
    return customer.id;
  }

  /**
   * Start a checkout for a tier.
   *
   * Prices are created on the fly from entitlements.ts rather than referencing
   * dashboard price ids, so there is exactly one place where a price lives.
   * (For high volume you would pre-create Products/Prices and cache the ids;
   * at this scale correctness beats the round trip.)
   */
  async createCheckout(params: {
    userId: string;
    customerId: string;
    tier: Exclude<Tier, 'FREE'>;
    period: BillingPeriod;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    const amount = priceMinor(params.tier, params.period);
    const def = TIERS[params.tier];

    if (!this.isLive) {
      // Mock: a URL the app can recognise and short-circuit, so the upgrade
      // flow is walkable end-to-end before Stripe exists.
      return {
        id: `cs_mock_${Date.now()}`,
        url: `${params.successUrl}?mock=1&tier=${params.tier}&period=${params.period}`,
        live: false,
      };
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: params.customerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'gbp',
            unit_amount: amount,
            recurring: { interval: params.period === 'ANNUAL' ? 'year' : 'month' },
            product_data: {
              name: `SaveOnDrive ${def.name}`,
              description: def.tagline,
            },
          },
        },
      ],
      success_url: `${params.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: params.cancelUrl,
      // Repeated on both the session and the subscription: webhooks for
      // different event types carry different objects, and we need the member
      // id on whichever one arrives.
      metadata: { userId: params.userId, tier: params.tier, period: params.period },
      subscription_data: {
        metadata: { userId: params.userId, tier: params.tier, period: params.period },
      },
      allow_promotion_codes: true,
    });

    if (!session.url) throw new Error('Stripe returned a session without a URL');
    return { id: session.id, url: session.url, live: true };
  }

  /**
   * A link to Stripe's own billing portal, where a member can change card,
   * download invoices or cancel.
   *
   * Deliberately not rebuilt in-app: card handling is Stripe's job, and
   * touching card details ourselves would drag us into PCI scope for no gain.
   */
  async createPortalSession(customerId: string, returnUrl: string): Promise<string> {
    if (!this.isLive) return `${returnUrl}?mock_portal=1`;
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  /** Cancel at period end — they keep what they paid for. */
  async cancelAtPeriodEnd(subscriptionId: string): Promise<void> {
    if (!this.isLive) return;
    await this.stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  }

  /** Undo a pending cancellation. */
  async resumeSubscription(subscriptionId: string): Promise<void> {
    if (!this.isLive) return;
    await this.stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false });
  }

  /**
   * Verify a webhook came from Stripe.
   *
   * THE SIGNATURE CHECK IS THE WHOLE SECURITY MODEL of this endpoint. Without
   * it, anyone who knows the URL could POST "subscription active" and hand
   * themselves Pro for free. It needs the RAW body — a re-serialised JSON body
   * produces a different signature and every event fails.
   */
  constructEvent(rawBody: Buffer | string, signature: string): Stripe.Event {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not set — refusing to trust this webhook');
    }
    return this.stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  }

  async getSubscription(id: string): Promise<Stripe.Subscription | null> {
    if (!this.isLive) return null;
    try {
      return await this.stripe.subscriptions.retrieve(id);
    } catch {
      return null;
    }
  }
}

export const stripe = new StripeClient();
export type { Stripe };
