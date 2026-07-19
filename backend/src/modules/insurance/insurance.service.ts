import { prisma } from '../../lib/prisma.js';

/**
 * Insurance renewal optimiser.
 *
 * ── WHAT THIS HONESTLY IS ──
 * We do NOT quote insurance. Getting real premiums needs an FCA-authorised
 * arrangement with each insurer or an aggregator's panel, plus enough personal
 * data (claims history, licence, occupation, address) that collecting it
 * without that authorisation would be both useless and a data-protection
 * problem. Presenting a made-up premium as a quote would also be a regulated
 * activity performed illegally.
 *
 * What we CAN do, honestly and usefully, is the thing that actually saves
 * people money: tell them their renewal is coming, show them what the
 * auto-renewal loyalty penalty typically costs, and hand them off to the
 * comparison sites with their vehicle details already known.
 *
 * The FCA banned "price walking" in Jan 2022 — insurers may no longer quote
 * renewing customers more than a new customer for the same policy. Even so,
 * shopping around at renewal still beats accepting the invitation, and the
 * best window is well established: about 20–26 days before renewal.
 *
 * When a real aggregator partnership exists, quotes slot in beside this — the
 * `source` field already distinguishes a real quote from guidance.
 */

export interface RenewalGuidance {
  vehicleId: string;
  registration: string;
  renewalDate: string | null;
  daysUntilRenewal: number | null;
  /** Where they are in the shopping cycle. */
  window: 'TOO_EARLY' | 'OPTIMAL' | 'LATE' | 'OVERDUE' | 'UNKNOWN';
  headline: string;
  detail: string;
  actions: { label: string; url: string; note: string }[];
  /** Typical saving from switching, in pence. Clearly labelled as typical. */
  typicalSavingMinor: number | null;
  source: 'GUIDANCE' | 'QUOTE';
}

/**
 * Industry figures for switching vs auto-renewing, in pence. These are
 * published averages, not a promise to any individual — the UI must say so.
 */
const TYPICAL_SWITCH_SAVING_MINOR = 22_000; // ~£220

/**
 * The cheapest day to buy. Premiums rise steeply in the last week before
 * renewal because insurers price short-notice risk higher — this is the single
 * most valuable thing we can tell someone about their insurance.
 */
const OPTIMAL_DAYS_MIN = 20;
const OPTIMAL_DAYS_MAX = 26;

const COMPARISON_SITES = [
  {
    label: 'Compare the Market',
    url: 'https://www.comparethemarket.com/car-insurance/',
    note: 'Large panel; often includes insurers the others miss',
  },
  {
    label: 'MoneySuperMarket',
    url: 'https://www.moneysupermarket.com/car-insurance/',
    note: 'Good coverage of mainstream insurers',
  },
  {
    label: 'Confused.com',
    url: 'https://www.confused.com/car-insurance',
    note: 'Shows the cheapest across several panels',
  },
  {
    label: 'Direct Line / Aviva',
    url: 'https://www.directline.com/car-insurance',
    note: 'Not on comparison sites — worth a separate quote',
  },
];

export async function renewalGuidance(userId: string, vehicleId?: string): Promise<RenewalGuidance[]> {
  const vehicles = await prisma.vehicle.findMany({
    where: { userId, ...(vehicleId ? { id: vehicleId } : {}) },
    orderBy: { createdAt: 'asc' },
  });

  return vehicles.map((v) => {
    const renewal = v.insuranceRenewalDate;
    const days = renewal
      ? Math.ceil((renewal.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : null;

    let window: RenewalGuidance['window'] = 'UNKNOWN';
    let headline: string;
    let detail: string;

    if (days === null) {
      headline = 'Add your renewal date';
      detail =
        'No public database publishes when your insurance renews, so we need you to tell us. ' +
        'Once we know, we will remind you at the point in the cycle when quotes are cheapest.';
    } else if (days < 0) {
      window = 'OVERDUE';
      headline = `Renewal was ${Math.abs(days)} days ago`;
      detail =
        'If this renewed automatically you are likely on a price you never compared. ' +
        'It is worth checking now — you can usually switch mid-policy for a small fee.';
    } else if (days <= 3) {
      window = 'LATE';
      headline = `Renews in ${days} day${days === 1 ? '' : 's'}`;
      detail =
        'Premiums rise sharply in the last few days before renewal because insurers price ' +
        'short-notice cover higher. Still worth comparing — just expect less of a gap than ' +
        'you would have had three weeks ago.';
    } else if (days >= OPTIMAL_DAYS_MIN && days <= OPTIMAL_DAYS_MAX) {
      window = 'OPTIMAL';
      headline = `Best time to shop — ${days} days to renewal`;
      detail =
        'This is the cheapest point in the cycle. Quotes taken around three weeks out are ' +
        'consistently lower than both earlier and later ones, because insurers treat ' +
        'short-notice buyers as higher risk.';
    } else if (days > OPTIMAL_DAYS_MAX) {
      window = 'TOO_EARLY';
      headline = `${days} days to renewal`;
      detail =
        `We will nudge you at ${OPTIMAL_DAYS_MAX} days out, when quotes are typically at their ` +
        'lowest. Shopping much earlier than that usually costs you more, not less.';
    } else {
      window = 'LATE';
      headline = `Renews in ${days} days`;
      detail =
        'Slightly past the cheapest window but still well worth comparing before you let it ' +
        'renew automatically.';
    }

    return {
      vehicleId: v.id,
      registration: v.registration,
      renewalDate: renewal ? renewal.toISOString().slice(0, 10) : null,
      daysUntilRenewal: days,
      window,
      headline,
      detail,
      actions:
        days === null
          ? [{ label: 'Add renewal date', url: 'app://vehicles', note: 'Takes a few seconds' }]
          : COMPARISON_SITES.map((s) => ({ label: s.label, url: s.url, note: s.note })),
      typicalSavingMinor: days === null ? null : TYPICAL_SWITCH_SAVING_MINOR,
      // Guidance, not a quote. When a real panel is integrated this becomes
      // 'QUOTE' and carries actual premiums.
      source: 'GUIDANCE',
    };
  });
}
