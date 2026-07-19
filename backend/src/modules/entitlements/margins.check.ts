/**
 * Guards the unit economics.
 *
 * The first draft of the pricing lost £155 per Premium member and £353 per Pro
 * member per year — losses that scale with growth. That was caught by doing the
 * arithmetic, so the arithmetic now runs on every build.
 *
 * Run with `npm run check:margins`. Non-zero exit fails CI.
 */
import {
  annualPerkCostMinor,
  grossMargin,
  priceMinor,
  TIER_ORDER,
  TIERS,
  type BillingPeriod,
  type Tier,
} from './entitlements.js';

/** Below this, a tier isn't worth selling once support and payment fees land. */
const MIN_GROSS_MARGIN = 0.25;

const gbp = (minor: number): string => `£${(minor / 100).toFixed(2)}`;

function main(): void {
  let failed = false;
  console.log('Membership unit economics (annual, per member)\n');

  for (const tier of TIER_ORDER) {
    const def = TIERS[tier];
    if (def.monthlyMinor === 0) {
      console.log(`${def.name.padEnd(8)} free tier — acquisition, no perk cost expected`);
      const cost = annualPerkCostMinor(tier);
      if (cost > 0) {
        console.error(`  ✗ the free tier hands out ${gbp(cost)} of perks a year`);
        failed = true;
      }
      console.log('');
      continue;
    }

    for (const period of ['MONTHLY', 'ANNUAL'] as BillingPeriod[]) {
      const revenue = period === 'ANNUAL' ? def.annualMinor : def.monthlyMinor * 12;
      const cost = annualPerkCostMinor(tier);
      const margin = grossMargin(tier, period);
      const ok = margin >= MIN_GROSS_MARGIN;
      if (!ok) failed = true;

      console.log(
        `${def.name.padEnd(8)} ${period.padEnd(8)} ` +
          `revenue ${gbp(revenue).padStart(9)}  ` +
          `perks ${gbp(cost).padStart(9)}  ` +
          `margin ${(margin * 100).toFixed(1).padStart(5)}%  ${ok ? '✓' : '✗ TOO LOW'}`,
      );
    }
    console.log('');
  }

  // The annual price must actually be a discount, or the pricing page lies.
  for (const tier of TIER_ORDER) {
    const def = TIERS[tier];
    if (def.monthlyMinor === 0) continue;
    const twelveMonths = def.monthlyMinor * 12;
    if (def.annualMinor >= twelveMonths) {
      console.error(
        `✗ ${def.name}: annual ${gbp(def.annualMinor)} is not cheaper than ` +
          `12 × monthly ${gbp(twelveMonths)} — we advertise a discount`,
      );
      failed = true;
    }
  }

  // Tiers must get strictly more expensive as they get better.
  for (let i = 1; i < TIER_ORDER.length; i++) {
    const lower = TIER_ORDER[i - 1]!;
    const higher = TIER_ORDER[i]!;
    for (const period of ['MONTHLY', 'ANNUAL'] as BillingPeriod[]) {
      if (priceMinor(higher, period) <= priceMinor(lower, period)) {
        console.error(`✗ ${higher} is not priced above ${lower} (${period})`);
        failed = true;
      }
    }
    // …and strictly more capable.
    const lowerFeatures = new Set<string>(TIERS[lower].features);
    const missing = [...lowerFeatures].filter((f) => !TIERS[higher].features.includes(f as never));
    if (missing.length > 0) {
      console.error(`✗ ${higher} is missing features that ${lower} has: ${missing.join(', ')}`);
      failed = true;
    }
  }

  if (failed) {
    console.error(
      `\nFAILED — a tier is below the ${(MIN_GROSS_MARGIN * 100).toFixed(0)}% gross margin floor, ` +
        `or the tiers are inconsistent. Adjust perks or price in entitlements.ts.`,
    );
    process.exit(1);
  }
  console.log('All tiers viable ✓');
}

main();
