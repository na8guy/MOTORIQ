import type { ServicePartner } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Price comparison for MOTs, servicing and tyres — "shop for the cheapest",
 * which is the whole point of the marketplace.
 *
 * ── HOW PRICES ARE ARRIVED AT, AND HOW HONEST WE ARE ABOUT IT ──
 * There is no national garage-pricing API. Real prices come from three places,
 * and every quote says which one it is, because a firm price and an estimate
 * are different promises:
 *
 *   FIXED     — the partner has given us this price. Bookable at this price.
 *   FROM      — the partner's published starting price; the final bill depends
 *               on the vehicle. Bookable, with the caveat shown.
 *   ESTIMATE  — we have no price from this partner, so it's a regional average
 *               by vehicle class. NOT bookable at a promised price.
 *
 * The MOT ceiling is the exception and it's a legal fact, not a guess: DVSA
 * caps a class-4 car MOT at £54.85. Any garage quoting above that for a car is
 * either wrong or not doing a class-4 test, so we clamp and flag it.
 */

/** DVSA statutory maximum fees, in pence. These are law, not estimates. */
export const MOT_MAX_FEE_MINOR = {
  /** Class 4: cars, up to 8 passenger seats. */
  CAR: 5485,
  /** Class 7: goods vehicles 3,000–3,500kg. */
  VAN: 5850,
  /** Class 1/2: motorcycles. */
  MOTORCYCLE: 2965,
} as const;

export type ServiceType = 'MOT' | 'SERVICE' | 'TYRES' | 'VALETING' | 'REPAIR';
export type PriceBasis = 'FIXED' | 'FROM' | 'ESTIMATE';

export interface Quote {
  partnerId: string;
  partnerName: string;
  address: string;
  postcode: string;
  distanceKm: number;
  rating: number | null;
  ratingCount: number;
  vetted: boolean;
  bookable: boolean;

  serviceType: ServiceType;
  priceMinor: number;
  basis: PriceBasis;
  /** Plain-English caveat, always shown next to the price. */
  priceNote: string;

  /** What a membership perk knocks off. */
  perkCoversMinor: number;
  /** What the member would actually pay. */
  youPayMinor: number;

  /** Saving against the most expensive quote in this comparison. */
  savingVsDearestMinor: number;
  rank: number;
}

export interface QuoteComparison {
  serviceType: ServiceType;
  quotes: Quote[];
  cheapestMinor: number | null;
  dearestMinor: number | null;
  /** The spread — the number that shows why comparing is worth it. */
  spreadMinor: number;
  /** Regional average, for context. */
  averageMinor: number | null;
  partnersFound: number;
  /** True when at least one quote is a real partner price, not an estimate. */
  hasRealPrices: boolean;
  note: string | null;
}

/**
 * Regional estimates by service, in pence. Used ONLY where a partner has given
 * us no price, and always labelled ESTIMATE.
 *
 * Sourced from published UK averages (2026). Deliberately conservative — an
 * estimate that comes in under the real bill is worse than one that doesn't,
 * because the member has already committed by the time they find out.
 */
const REGIONAL_ESTIMATE_MINOR: Record<ServiceType, number> = {
  MOT: 4500,
  SERVICE: 17500, // interim/full average
  TYRES: 9000, // per tyre, mid-range
  VALETING: 5000,
  REPAIR: 0, // never estimated: a repair price without a diagnosis is fiction
};

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Pull a partner's own price for a service, if they've given us one. */
function partnerPrice(
  partner: ServicePartner & { priceList?: unknown },
  serviceType: ServiceType,
): { priceMinor: number; basis: PriceBasis } | null {
  const list = partner.priceList as Record<string, { minor: number; basis?: string }> | null;
  const entry = list?.[serviceType];
  if (!entry || typeof entry.minor !== 'number' || entry.minor <= 0) return null;
  return {
    priceMinor: entry.minor,
    basis: entry.basis === 'FROM' ? 'FROM' : 'FIXED',
  };
}

/**
 * Compare prices for a service near a member, cheapest first.
 *
 * `perkRemaining` is what their membership still covers this period, applied
 * to each quote so the comparison shows what THEY pay rather than the list
 * price — which is the number that actually decides where they go.
 */
export async function compareQuotes(params: {
  latitude: number;
  longitude: number;
  serviceType: ServiceType;
  radiusKm?: number;
  limit?: number;
  vehicleClass?: keyof typeof MOT_MAX_FEE_MINOR;
  perkCoversMinor?: number;
}): Promise<QuoteComparison> {
  const radiusKm = params.radiusKm ?? 25;
  const limit = params.limit ?? 8;
  const perkPot = params.perkCoversMinor ?? 0;

  const partners = await prisma.servicePartner.findMany({
    where: { active: true, services: { has: params.serviceType } },
    take: 300,
  });

  const near = partners
    .map((p) => ({
      partner: p,
      distanceKm:
        Math.round(
          haversineKm({ lat: params.latitude, lng: params.longitude }, { lat: p.latitude, lng: p.longitude }) * 10,
        ) / 10,
    }))
    .filter((x) => x.distanceKm <= radiusKm);

  if (near.length === 0) {
    return {
      serviceType: params.serviceType,
      quotes: [],
      cheapestMinor: null,
      dearestMinor: null,
      spreadMinor: 0,
      averageMinor: null,
      partnersFound: 0,
      hasRealPrices: false,
      note:
        'No partner garages within range yet. Partner coverage is being built out — ' +
        'we would rather show you nothing than send you somewhere we have not checked.',
    };
  }

  const priced = near.map(({ partner, distanceKm }) => {
    const own = partnerPrice(partner, params.serviceType);
    let priceMinor: number;
    let basis: PriceBasis;
    let priceNote: string;

    if (own) {
      priceMinor = own.priceMinor;
      basis = own.basis;
      priceNote =
        own.basis === 'FIXED'
          ? 'Fixed price from this garage'
          : 'Starting price — the final bill depends on your vehicle';
    } else {
      priceMinor = REGIONAL_ESTIMATE_MINOR[params.serviceType];
      basis = 'ESTIMATE';
      priceNote = 'Estimated from regional averages — this garage has not published a price';
    }

    // The MOT cap is law. A car MOT above £54.85 is not a class-4 test.
    if (params.serviceType === 'MOT') {
      const cap = MOT_MAX_FEE_MINOR[params.vehicleClass ?? 'CAR'];
      if (priceMinor > cap) {
        priceMinor = cap;
        priceNote = `Capped at the DVSA maximum fee of £${(cap / 100).toFixed(2)}`;
      }
    }

    const perkCoversMinor = Math.min(perkPot, priceMinor);
    return {
      partnerId: partner.id,
      partnerName: partner.name,
      address: partner.address,
      postcode: partner.postcode,
      distanceKm,
      rating: partner.rating,
      ratingCount: partner.ratingCount,
      vetted: partner.vetted,
      // Only a vetted partner with a real price can be booked at that price.
      bookable: partner.vetted && basis !== 'ESTIMATE',
      serviceType: params.serviceType,
      priceMinor,
      basis,
      priceNote,
      perkCoversMinor,
      youPayMinor: Math.max(0, priceMinor - perkCoversMinor),
      savingVsDearestMinor: 0, // filled in below
      rank: 0,
    };
  });

  // Rank on what the member actually pays, then distance as the tiebreak.
  priced.sort((a, b) => a.youPayMinor - b.youPayMinor || a.distanceKm - b.distanceKm);

  const prices = priced.map((q) => q.priceMinor);
  const dearest = Math.max(...prices);
  const cheapest = Math.min(...prices);
  const average = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);

  const quotes = priced.slice(0, limit).map((q, i) => ({
    ...q,
    rank: i + 1,
    savingVsDearestMinor: dearest - q.priceMinor,
  }));

  const hasRealPrices = quotes.some((q) => q.basis !== 'ESTIMATE');

  return {
    serviceType: params.serviceType,
    quotes,
    cheapestMinor: cheapest,
    dearestMinor: dearest,
    spreadMinor: dearest - cheapest,
    averageMinor: average,
    partnersFound: near.length,
    hasRealPrices,
    note: hasRealPrices
      ? null
      : 'None of these garages has published a price yet, so all figures are regional ' +
        'estimates. Ring ahead before you commit.',
  };
}
