import { request } from 'undici';
import { env } from '../../config/env.js';

/**
 * EV charging via Open Charge Map (openchargemap.org) — free, community-run,
 * with a free API key (My Profile → My Apps → Register Application).
 *
 * THE HONEST LIMITATION: unlike petrol, EV charging prices are not published as
 * open data anywhere in the UK. OCM has a `UsageCost` field, but it is FREE
 * TEXT written by contributors — "£0.45/kWh", "45p per kWh", "Free", "Parking
 * fees apply", "" — not a number. So:
 *
 *   • Where a per-kWh price can be parsed, we rank on it (cheapest first) and
 *     compute savings, exactly like fuel.
 *   • Where it can't, the site is still shown, ranked below the priced ones by
 *     distance, and clearly marked "price not published".
 *
 * We never guess a price. A member driving to a charger on an invented price is
 * worse than one who knows we don't know.
 */

export interface Charger {
  id: string;
  title: string;
  operator: string | null;
  address: string;
  postcode: string;
  latitude: number;
  longitude: number;
  /** Fastest connector at the site, kW. */
  maxPowerKw: number | null;
  connectorTypes: string[];
  /** Total connectors, and how many are usable right now (if OCM knows). */
  points: number;
  /** Parsed pence per kWh — null when the site publishes no usable price. */
  pricePencePerKwh: number | null;
  /** The raw contributor text, so the app can show exactly what was said. */
  usageCostText: string | null;
  /** OCM's operational status, e.g. "Operational". */
  status: string | null;
  isOperational: boolean | null;
  /** True when charging is free (parking may still cost). */
  isFree: boolean;
  distanceKm?: number;
}

interface OcmConnection {
  ConnectionType?: { Title?: string };
  PowerKW?: number | null;
  Quantity?: number | null;
  StatusType?: { IsOperational?: boolean | null };
}

interface OcmPoi {
  ID?: number;
  UUID?: string;
  AddressInfo?: {
    Title?: string;
    AddressLine1?: string;
    Town?: string;
    Postcode?: string;
    Latitude?: number;
    Longitude?: number;
    Distance?: number;
  };
  OperatorInfo?: { Title?: string } | null;
  UsageCost?: string | null;
  UsageType?: { IsPayAtLocation?: boolean; Title?: string } | null;
  StatusType?: { Title?: string; IsOperational?: boolean | null } | null;
  Connections?: OcmConnection[];
  NumberOfPoints?: number | null;
}

/**
 * Pull a pence-per-kWh figure out of contributor free text.
 *
 * Deliberately conservative: it only accepts text that clearly states a rate
 * per kWh. "£2 per hour" and "Parking £3" are NOT charging rates and must not
 * be treated as one — returning null (unknown) is always better than a wrong
 * number that sends someone to the wrong charger.
 */
export function parseUsageCost(raw: string | null | undefined): {
  pencePerKwh: number | null;
  isFree: boolean;
} {
  if (!raw) return { pencePerKwh: null, isFree: false };
  const text = raw.toLowerCase().trim();
  if (!text) return { pencePerKwh: null, isFree: false };

  // "Free", "No charge", "Free to use" — but not "Free parking, £0.45/kWh",
  // which is handled by falling through to the rate patterns below.
  const mentionsRate = /kwh|kw\/h|per kw/.test(text);
  if (!mentionsRate && /^(free|no charge|free to use|free of charge|£0(\.00)?)\b/.test(text)) {
    return { pencePerKwh: 0, isFree: true };
  }

  // Only ever read a number that is explicitly tied to kWh.
  const patterns: RegExp[] = [
    /£\s*(\d+(?:\.\d+)?)\s*(?:\/|per\s*|p\/)?\s*kwh/, // £0.45/kWh, £0.45 per kWh
    /(\d+(?:\.\d+)?)\s*p(?:ence)?\s*(?:\/|per\s*)\s*kwh/, // 45p/kWh, 45 pence per kWh
    /(\d+(?:\.\d+)?)\s*p\s*kwh/, // 45p kWh
    /kwh[^0-9£]{0,12}£\s*(\d+(?:\.\d+)?)/, // kWh: £0.45
    /kwh[^0-9]{0,12}(\d+(?:\.\d+)?)\s*p\b/, // kWh 45p
  ];

  for (const re of patterns) {
    const m = re.exec(text);
    if (!m?.[1]) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 0) continue;

    // Disambiguate pounds from pence by magnitude: "£0.45/kWh" is 45p, while
    // "45p/kWh" is also 45p. Anything at or under 5 was quoted in pounds.
    const pence = /^£/.test(m[0]) || n <= 5 ? n * 100 : n;

    // Sanity-check against reality: UK public charging runs roughly 20–120p/kWh.
    // Outside that the text almost certainly meant something else (a parking
    // fee, a subscription), so treat it as unknown rather than mislead.
    if (pence < 5 || pence > 200) continue;
    return { pencePerKwh: Math.round(pence * 10) / 10, isFree: false };
  }

  return { pencePerKwh: null, isFree: false };
}

function mapPoi(p: OcmPoi): Charger | null {
  const a = p.AddressInfo;
  if (!a?.Latitude || !a?.Longitude) return null;

  const conns = p.Connections ?? [];
  const powers = conns.map((c) => c.PowerKW).filter((n): n is number => typeof n === 'number' && n > 0);
  const cost = parseUsageCost(p.UsageCost);

  return {
    id: String(p.UUID ?? p.ID ?? `${a.Latitude},${a.Longitude}`),
    title: a.Title ?? 'Charging point',
    operator: p.OperatorInfo?.Title ?? null,
    address: [a.AddressLine1, a.Town].filter(Boolean).join(', ') || (a.Title ?? ''),
    postcode: a.Postcode ?? '',
    latitude: a.Latitude,
    longitude: a.Longitude,
    maxPowerKw: powers.length ? Math.max(...powers) : null,
    connectorTypes: [
      ...new Set(conns.map((c) => c.ConnectionType?.Title).filter((t): t is string => !!t)),
    ],
    points: p.NumberOfPoints ?? conns.reduce((sum, c) => sum + (c.Quantity ?? 1), 0),
    pricePencePerKwh: cost.pencePerKwh,
    usageCostText: p.UsageCost?.trim() || null,
    status: p.StatusType?.Title ?? null,
    isOperational: p.StatusType?.IsOperational ?? null,
    isFree: cost.isFree,
    distanceKm: a.Distance ?? undefined,
  };
}

class OpenChargeMapClient {
  private cache = new Map<string, { at: number; chargers: Charger[] }>();

  /** True when a real API key is configured (OCM 403s without one). */
  get isLive(): boolean {
    return !!env.OCM_API_KEY;
  }

  /**
   * Chargers near a point, nearest first. Returns [] rather than throwing —
   * the EV tab should show an honest empty state, not an error.
   */
  async nearby(params: {
    latitude: number;
    longitude: number;
    radiusKm?: number;
    limit?: number;
    minPowerKw?: number;
  }): Promise<Charger[]> {
    const radiusKm = params.radiusKm ?? 15;
    const limit = params.limit ?? 50;

    if (!this.isLive) return [];

    // Round the cache key so nearby lookups share an entry rather than missing
    // on every metre of GPS jitter. ~1km buckets.
    const key = `${params.latitude.toFixed(2)},${params.longitude.toFixed(2)},${radiusKm},${params.minPowerKw ?? 0}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.chargers.slice(0, limit);

    try {
      const url =
        `${env.OCM_BASE_URL}?output=json&countrycode=GB` +
        `&latitude=${params.latitude}&longitude=${params.longitude}` +
        `&distance=${radiusKm}&distanceunit=KM` +
        // Ask for more than we need: we re-rank by price, so the nearest N is
        // not the same set as the cheapest N.
        `&maxresults=${Math.min(200, limit * 4)}` +
        `&compact=false&verbose=false` +
        (params.minPowerKw ? `&minpowerkw=${params.minPowerKw}` : '');

      const res = await request(url, {
        method: 'GET',
        headers: {
          'x-api-key': env.OCM_API_KEY!,
          'user-agent': 'MOTORIQ/1.0 (+https://motoriq.co.uk)',
          accept: 'application/json',
        },
        headersTimeout: 12_000,
        bodyTimeout: 12_000,
      });

      if (res.statusCode >= 400) {
        const body = await res.body.text();
        console.warn(`[ev] Open Charge Map responded ${res.statusCode}: ${body.slice(0, 160)}`);
        return [];
      }

      const data = (await res.body.json()) as OcmPoi[];
      const chargers = (Array.isArray(data) ? data : [])
        .map(mapPoi)
        .filter((c): c is Charger => c !== null)
        .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));

      this.cache.set(key, { at: Date.now(), chargers });
      console.log(`[ev] loaded ${chargers.length} chargers near ${key}`);
      return chargers.slice(0, limit);
    } catch (err) {
      console.warn(`[ev] lookup failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }
}

export const openChargeMap = new OpenChargeMapClient();
