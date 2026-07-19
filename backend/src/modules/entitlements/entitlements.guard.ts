import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import {
  lowestTierWith,
  TIERS,
  tierHasFeature,
  type Feature,
  type Tier,
} from './entitlements.js';

/**
 * Server-side paywall.
 *
 * THIS IS THE ONLY THING THAT ACTUALLY GATES A FEATURE. The app hides locked
 * screens for the sake of the member's experience, but hiding a button is not
 * security — anyone can call the API directly with a valid token. So every
 * paid capability is enforced here, against the tier stored in the database,
 * on every request.
 *
 * Two rules that matter:
 *
 *  1. The tier comes from the DATABASE, never from the JWT. A JWT is issued at
 *     login and lives for its full lifetime, so a token minted while someone
 *     was Pro would keep working after they cancelled. Reading the row costs a
 *     query and is always correct.
 *
 *  2. Access requires an ACTIVE subscription, not merely a tier value. A
 *     cancelled or past-due subscription must lose its features at the end of
 *     the paid period, or "cancel and keep using it" is free Pro.
 */

/** 402 Payment Required — the app turns this into an upgrade prompt. */
export function PaymentRequired(
  message: string,
  details: { feature: Feature; currentTier: Tier; requiredTier: Tier },
): AppError {
  return new AppError(402, 'PAYMENT_REQUIRED', message, details);
}

export interface Entitlement {
  tier: Tier;
  /** True when the subscription is paid up (or the tier is free). */
  active: boolean;
  /** Set when an admin is impersonating a tier to test it. */
  simulated: boolean;
  features: readonly Feature[];
}

/**
 * The member's effective tier right now.
 *
 * An admin may simulate a tier to test its features (see admin routes). That is
 * deliberately recorded on the user row rather than inferred, so it shows up in
 * an audit and can never be set by the member themselves.
 */
export async function entitlementFor(userId: string): Promise<Entitlement> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      tier: true,
      role: true,
      email: true,
      simulatedTier: true,
      subscription: { select: { status: true, currentPeriodEnd: true, plan: true } },
    },
  });
  if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Account not found');

  // Admin tier simulation — for testing paid features without paying.
  if (user.simulatedTier && isAdmin(user)) {
    const tier = user.simulatedTier as Tier;
    return { tier, active: true, simulated: true, features: TIERS[tier].features };
  }

  const tier = user.tier as Tier;

  // The free tier is always "active": there is nothing to pay for.
  if (tier === 'FREE') {
    return { tier, active: true, simulated: false, features: TIERS.FREE.features };
  }

  const sub = user.subscription;
  const paidUp =
    sub != null &&
    (sub.status === 'ACTIVE' || sub.status === 'TRIALING' ||
      // A cancelled subscription keeps its features until the period they paid
      // for actually ends — they bought that time.
      (sub.status === 'CANCELLED' && sub.currentPeriodEnd != null && sub.currentPeriodEnd > new Date()));

  // Lapsed: fall back to free rather than locking them out of the app entirely.
  if (!paidUp) {
    return { tier: 'FREE', active: false, simulated: false, features: TIERS.FREE.features };
  }

  return { tier, active: true, simulated: false, features: TIERS[tier].features };
}

function isAdmin(user: { role: string; email: string }): boolean {
  return user.role === 'ADMIN' || user.email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase();
}

/**
 * Fastify hook factory: gate a route on a feature.
 *
 *   app.get('/parking/nearby', { onRequest: [app.authenticate, requireFeature('parking.finder')] }, …)
 *
 * Throws 402 with the tier the member needs, so the app can show a specific
 * "Upgrade to Premium to unlock parking" rather than a generic error.
 */
export function requireFeature(feature: Feature) {
  return async function featureGuard(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const ent = await entitlementFor(req.authUser.sub);
    if (tierHasFeature(ent.tier, feature)) return;

    const required = lowestTierWith(feature);
    if (!required) {
      // A feature no tier grants is a configuration mistake, not a paywall.
      throw new AppError(500, 'INTERNAL_ERROR', `Feature ${feature} is not in any tier`);
    }

    throw PaymentRequired(
      `${TIERS[required].name} unlocks this. ${upgradeReason(feature)}`,
      { feature, currentTier: ent.tier, requiredTier: required },
    );
  };
}

/** Member-facing explanation of what they'd be buying. */
function upgradeReason(feature: Feature): string {
  const reasons: Partial<Record<Feature, string>> = {
    'parking.finder': 'Find and compare parking near your destination.',
    'ulez.checker': 'Check ULEZ and clean-air charges before you drive.',
    'booking.marketplace': 'Book MOTs, servicing and tyres with vetted garages in one tap.',
    'maintenance.predictive': 'Get warned about faults before they strand you.',
    'insurance.optimizer': 'Compare renewal quotes and cut your premium.',
    'expense.reports': 'Export mileage and fuel for your tax return.',
    'vehicles.multi': 'Add the whole family’s vehicles.',
    'card.virtual': 'Get your fuel card and monthly litres.',
    'cashback': 'Earn cashback on every fill-up.',
    'glovebox.digital': 'Keep your MOT, insurance and service history in one place.',
    'savings.dashboard': 'See exactly what you have saved, month by month.',
    'forecast.detailed': 'Forecast next year’s running costs.',
  };
  return reasons[feature] ?? 'Upgrade to unlock this feature.';
}

/**
 * Non-throwing check, for routes that serve both tiers but degrade — e.g. the
 * fuel list shows 3 results free and 10 with Premium.
 */
export async function hasFeature(userId: string, feature: Feature): Promise<boolean> {
  const ent = await entitlementFor(userId);
  return tierHasFeature(ent.tier, feature);
}
