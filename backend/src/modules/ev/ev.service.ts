import { openChargeMap, type Charger } from '../../integrations/ev/openchargemap.client.js';
import { driveTimes, estimateDriveTime, type DriveTime } from '../../integrations/routing/routing.client.js';
import { EV_SAMPLE_CHARGERS } from './sample-chargers.js';

/**
 * Ranked EV charging, mirroring the fuel tab: cheapest first, with what you
 * save versus the local average.
 *
 * The catch, and it's a real one: UK EV charging prices are not open data.
 * Open Charge Map's cost field is contributor-written free text, so a per-kWh
 * price can only be read for some sites. Those are ranked cheapest-first;
 * everything else is listed below them by distance and labelled "price not
 * published". We never invent a price to fill a gap.
 */

export interface RankedCharger extends Charger {
  rank: number;
  /** Saving vs the local average, over a typical charge. Null when unpriced. */
  savingVsAverageMinor: number | null;
  /** Extra vs the cheapest priced option. Null when unpriced. */
  extraVsCheapestMinor: number | null;
  navigationUrl: string;
  eta: { seconds: number; metres: number; routed: boolean } | null;
  /** False when this site publishes no usable price — shown, but not ranked on. */
  hasPrice: boolean;
}

export interface RankedChargerResult {
  kwh: number;
  averagePence: number | null;
  cheapestPence: number | null;
  results: RankedCharger[];
  source: 'live' | 'mock';
  chargersInRadius: number;
  /** How many nearby sites publish no price — the app should say so. */
  unpricedCount: number;
}

/**
 * Energy assumed for "you'd save £X". A full 0–100% charge is unrealistic —
 * most public charging is a top-up — so we price a typical 30 kWh session
 * rather than flatter the numbers with a 77 kWh full pack.
 */
const TYPICAL_KWH = 30;

const navUrl = (lat: number, lng: number): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;

export async function rankedChargers(params: {
  latitude: number;
  longitude: number;
  radiusKm?: number;
  limit?: number;
  minPowerKw?: number;
  kwh?: number;
}): Promise<RankedChargerResult> {
  const kwh = params.kwh ?? TYPICAL_KWH;
  const limit = params.limit ?? 3;

  let chargers = await openChargeMap.nearby({
    latitude: params.latitude,
    longitude: params.longitude,
    radiusKm: params.radiusKm ?? 15,
    limit: 60,
    minPowerKw: params.minPowerKw,
  });

  // Without an OCM key the API 403s, so fall back to samples rather than an
  // empty screen — flagged as mock so the app can say they aren't real.
  const source: 'live' | 'mock' = openChargeMap.isLive && chargers.length > 0 ? 'live' : 'mock';
  if (source === 'mock') {
    chargers = nearbySamples(params.latitude, params.longitude, params.radiusKm ?? 15);
  }

  const chargersInRadius = chargers.length;
  if (chargersInRadius === 0) {
    return {
      kwh,
      averagePence: null,
      cheapestPence: null,
      results: [],
      source,
      chargersInRadius: 0,
      unpricedCount: 0,
    };
  }

  // Out-of-service sites are worse than useless — don't send anyone to one.
  const usable = chargers.filter((c) => c.isOperational !== false);

  const priced = usable
    .filter((c): c is Charger & { pricePencePerKwh: number } => c.pricePencePerKwh != null)
    .sort((a, b) => a.pricePencePerKwh - b.pricePencePerKwh);
  const unpriced = usable
    .filter((c) => c.pricePencePerKwh == null)
    .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));

  // Benchmark from paid sites only: free chargers would drag the "average"
  // down and make every paid one look like a rip-off.
  const paid = priced.filter((c) => c.pricePencePerKwh > 0);
  const averagePence =
    paid.length > 0 ? paid.reduce((s, c) => s + c.pricePencePerKwh, 0) / paid.length : null;
  const cheapestPence = priced[0]?.pricePencePerKwh ?? null;

  // Cheapest first; unpriced sites fill remaining slots, nearest first.
  const chosen = [...priced, ...unpriced].slice(0, limit);

  const etas = await driveTimes(
    { lat: params.latitude, lng: params.longitude },
    chosen.map((c) => ({ lat: c.latitude, lng: c.longitude })),
  ).catch(() => chosen.map(() => null as DriveTime | null));

  const results: RankedCharger[] = chosen.map((c, i) => {
    const hasPrice = c.pricePencePerKwh != null;
    return {
      ...c,
      rank: i + 1,
      hasPrice,
      savingVsAverageMinor:
        hasPrice && averagePence != null
          ? Math.max(0, Math.round((averagePence - c.pricePencePerKwh!) * kwh))
          : null,
      extraVsCheapestMinor:
        hasPrice && cheapestPence != null
          ? Math.round((c.pricePencePerKwh! - cheapestPence) * kwh)
          : null,
      navigationUrl: navUrl(c.latitude, c.longitude),
      eta: etas[i] ?? (c.distanceKm != null ? estimateDriveTime(c.distanceKm) : null),
    };
  });

  return {
    kwh,
    averagePence: averagePence != null ? Math.round(averagePence * 10) / 10 : null,
    cheapestPence,
    results,
    source,
    chargersInRadius,
    unpricedCount: unpriced.length,
  };
}

/** Sample chargers near a point, so the EV tab is demoable without an OCM key. */
function nearbySamples(lat: number, lng: number, radiusKm: number): Charger[] {
  return EV_SAMPLE_CHARGERS.map((c) => ({
    ...c,
    distanceKm: haversineKm({ lat, lng }, { lat: c.latitude, lng: c.longitude }),
  }))
    .filter((c) => c.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
