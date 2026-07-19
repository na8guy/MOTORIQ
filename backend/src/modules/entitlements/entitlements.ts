/**
 * What each membership tier unlocks — the single source of truth.
 *
 * Every paywall decision in the API reads from here, and the app renders its
 * pricing screen from the same data (served by GET /subscriptions/plans). One
 * definition means the app can never advertise a perk the server won't honour,
 * and a tier change is a one-line edit rather than a hunt through the codebase.
 *
 * ── ON THE PERK SIZING ──
 * The fuel perk is deliberately smaller than first proposed. At 25 L/month a
 * £39 membership hands back £36.25 of fuel — 93% of revenue — before a single
 * MOT, service or breakdown callout. Modelled over a year:
 *
 *   Premium @ 25 L: £468 revenue vs £623 cost  → −£155 per member
 *   Pro     @ 55 L: £948 revenue vs £1,301 cost → −£353 per member
 *
 * Losses that scale with growth are not a growth strategy, so the litres are
 * sized to hold roughly 30% gross margin at each price. The perk is still
 * substantial (£157/£348 a year of fuel) and the tier still clears the value
 * promised on the pricing page.
 *
 * The ANNUAL price is what binds. Twelve months at 15% off brings in less
 * revenue while the perks cost exactly the same, so a perk sized against the
 * monthly price quietly loses money on every annual subscriber — the members
 * you most want. Perks are therefore sized against the annual price and the
 * monthly plan simply earns more.
 *
 * If fuel prices move, change PETROL_PENCE_PER_LITRE and re-run
 * `npm run check:margins` — it fails the build if a tier stops being viable.
 */

export type Tier = 'FREE' | 'PREMIUM' | 'PRO';
export type BillingPeriod = 'MONTHLY' | 'ANNUAL';

/**
 * Every gated capability. Adding one here and referencing it in a route is the
 * whole job — see requireFeature() in entitlements.guard.ts.
 */
export type Feature =
  // Free — the acquisition surface. Deliberately generous: this is what makes
  // someone install the app in the first place.
  | 'fuel.finder'
  | 'ev.finder'
  | 'reminders.basic'
  | 'vehicle.lookup'
  | 'savings.basic'
  // Premium
  | 'fuel.alerts'
  | 'parking.finder'
  | 'ulez.checker'
  | 'reminders.predictive'
  | 'efficiency.coach'
  | 'forecast.basic'
  | 'cashback'
  | 'card.virtual'
  | 'breakdown.standard'
  | 'expense.reports'
  | 'savings.dashboard'
  | 'adfree'
  // Pro
  | 'maintenance.predictive'
  | 'forecast.detailed'
  | 'insurance.optimizer'
  | 'booking.marketplace'
  | 'vehicles.multi'
  | 'breakdown.premium'
  | 'rewards.gamified'
  | 'savings.guarantee'
  | 'support.priority'
  | 'glovebox.digital';

/** Perks with a cash cost to us — tracked per member, per period. */
export interface TierPerks {
  /** Litres of fuel loaded to the member's card each month. */
  fuelLitresPerMonth: number;
  /** Basic services included per year (or the credit below, in pence). */
  servicesPerYear: number;
  serviceCreditMinor: number;
  /** MOTs included per year. */
  motPerYear: number;
  /** 'NONE' | 'STANDARD' | 'PREMIUM'. */
  breakdownCover: 'NONE' | 'STANDARD' | 'PREMIUM';
  /** Cashback on fuel and charging bought with the card, in basis points. */
  cashbackBps: number;
  /** How many vehicles they can add. */
  maxVehicles: number;
}

export interface TierDefinition {
  tier: Tier;
  name: string;
  tagline: string;
  monthlyMinor: number;
  /** ~15% off twelve months. */
  annualMinor: number;
  features: readonly Feature[];
  perks: TierPerks;
  /** Marketing bullets — what the app's pricing screen shows. */
  highlights: readonly string[];
}

/** Used to value the fuel perk. Update when pump prices move materially. */
export const PETROL_PENCE_PER_LITRE = 145;

const FREE_FEATURES = [
  'fuel.finder',
  'ev.finder',
  'reminders.basic',
  'vehicle.lookup',
  'savings.basic',
] as const satisfies readonly Feature[];

const PREMIUM_FEATURES = [
  ...FREE_FEATURES,
  'fuel.alerts',
  'parking.finder',
  'ulez.checker',
  'reminders.predictive',
  'efficiency.coach',
  'forecast.basic',
  'cashback',
  'card.virtual',
  'breakdown.standard',
  'expense.reports',
  'savings.dashboard',
  'adfree',
] as const satisfies readonly Feature[];

const PRO_FEATURES = [
  ...PREMIUM_FEATURES,
  'maintenance.predictive',
  'forecast.detailed',
  'insurance.optimizer',
  'booking.marketplace',
  'vehicles.multi',
  'breakdown.premium',
  'rewards.gamified',
  'savings.guarantee',
  'support.priority',
  'glovebox.digital',
] as const satisfies readonly Feature[];

export const TIERS: Record<Tier, TierDefinition> = {
  FREE: {
    tier: 'FREE',
    name: 'Free',
    tagline: 'Find cheaper fuel, never miss an MOT',
    monthlyMinor: 0,
    annualMinor: 0,
    features: FREE_FEATURES,
    perks: {
      fuelLitresPerMonth: 0,
      servicesPerYear: 0,
      serviceCreditMinor: 0,
      motPerYear: 0,
      breakdownCover: 'NONE',
      cashbackBps: 0,
      maxVehicles: 1,
    },
    highlights: [
      'Cheapest fuel & EV charging near you',
      'MOT, tax and service reminders from DVLA',
      'Vehicle lookup by registration',
      'Your savings, tracked',
    ],
  },

  PREMIUM: {
    tier: 'PREMIUM',
    name: 'Premium',
    tagline: 'For everyday drivers',
    monthlyMinor: 3900,
    annualMinor: 39900, // £399 — ~15% off £468
    features: PREMIUM_FEATURES,
    perks: {
      // 6 L/month = £104/yr of fuel. Sized against the £399 ANNUAL price, which
      // is the binding constraint — at 9 L the annual plan made only 15.7%.
      fuelLitresPerMonth: 6,
      servicesPerYear: 1,
      serviceCreditMinor: 8000,
      motPerYear: 1,
      breakdownCover: 'STANDARD',
      cashbackBps: 300, // 3%
      maxVehicles: 2,
    },
    highlights: [
      '6 litres of fuel a month on your card',
      '1 free MOT + 1 service a year (or £80 credit)',
      'Nationwide breakdown & recovery',
      'Parking, ULEZ & clean-air zone tools',
      '3% cashback on fuel and charging',
      'Expense reports for tax',
    ],
  },

  PRO: {
    tier: 'PRO',
    name: 'Pro',
    tagline: 'For high-mileage drivers, families & the self-employed',
    monthlyMinor: 7900,
    annualMinor: 79900, // £799 — ~15% off £948
    features: PRO_FEATURES,
    perks: {
      // 15 L/month = £261/yr of fuel, sized against the £799 ANNUAL price.
      fuelLitresPerMonth: 15,
      servicesPerYear: 2,
      serviceCreditMinor: 20000,
      motPerYear: 1,
      breakdownCover: 'PREMIUM',
      cashbackBps: 300,
      maxVehicles: 6,
    },
    highlights: [
      '15 litres of fuel a month on your card',
      'Free MOT + 2 services a year (or £200 credit)',
      'Premium breakdown — faster response & towing',
      'One-tap MOT, service & tyre booking',
      'Predictive maintenance & cost forecasting',
      'Insurance optimiser & quotes',
      'Up to 6 vehicles for the family',
      'Priority support',
    ],
  },
};

export const TIER_ORDER: readonly Tier[] = ['FREE', 'PREMIUM', 'PRO'];

/** Is `tier` at or above `min`? Used for "upgrade to unlock" messaging. */
export function tierAtLeast(tier: Tier, min: Tier): boolean {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(min);
}

/** Does this tier include this feature? The one question the paywall asks. */
export function tierHasFeature(tier: Tier, feature: Feature): boolean {
  return TIERS[tier].features.includes(feature);
}

/** The cheapest tier that includes a feature — powers "Upgrade to Premium". */
export function lowestTierWith(feature: Feature): Tier | null {
  return TIER_ORDER.find((t) => tierHasFeature(t, feature)) ?? null;
}

/** Price for a tier on a billing period, in pence. */
export function priceMinor(tier: Tier, period: BillingPeriod): number {
  const def = TIERS[tier];
  return period === 'ANNUAL' ? def.annualMinor : def.monthlyMinor;
}

/**
 * Annual cost of the perks we hand out, in pence. Used by the margin check and
 * by the admin dashboard, so the true cost of a tier is never a guess.
 */
export function annualPerkCostMinor(tier: Tier): number {
  const p = TIERS[tier].perks;
  const fuel = p.fuelLitresPerMonth * 12 * PETROL_PENCE_PER_LITRE;
  const mot = p.motPerYear * 5500; // ~£55 trade
  const service = p.serviceCreditMinor;
  const breakdown = p.breakdownCover === 'PREMIUM' ? 6000 : p.breakdownCover === 'STANDARD' ? 4000 : 0;
  const cashback = Math.round(fuel * (p.cashbackBps / 10_000));
  return fuel + mot + service + breakdown + cashback;
}

/** Gross margin on a tier over a year, as a fraction of revenue. */
export function grossMargin(tier: Tier, period: BillingPeriod = 'MONTHLY'): number {
  const revenue = period === 'ANNUAL' ? TIERS[tier].annualMinor : TIERS[tier].monthlyMinor * 12;
  if (revenue === 0) return 0;
  return (revenue - annualPerkCostMinor(tier)) / revenue;
}
