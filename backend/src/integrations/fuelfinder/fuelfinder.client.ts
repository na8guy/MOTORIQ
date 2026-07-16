import { Agent, interceptors, request } from 'undici';
import { env } from '../../config/env.js';
import { UpstreamError } from '../../lib/errors.js';
import { SAMPLE_STATIONS } from './sample-data.js';

/**
 * UK fuel + EV price client with three modes (FUEL_FINDER_MODE):
 *
 *  - mock      : bundled sample stations (default; no network).
 *  - single    : one Fuel Finder REST endpoint returning {stations:[...]}.
 *                https://www.developer.fuel-finder.service.gov.uk
 *  - aggregate : fetch the UK scheme's public per-retailer JSON feeds and
 *                merge them. This is the real open-data path that works today
 *                (Asda, BP, Sainsbury's, Tesco, Morrisons, Esso/Moto, …).
 *
 * All modes normalise to the same `Station` shape. Fetched feeds are cached
 * in-process for FUEL_FEED_TTL_SECONDS.
 */

export type FuelKind = 'E10' | 'E5' | 'B7' | 'SDV' | 'ELECTRIC';

export interface FuelPrice {
  kind: FuelKind;
  pricePence: number; // pence per litre (per kWh for ELECTRIC)
}

export interface Station {
  siteId: string;
  brand: string;
  address: string;
  postcode: string;
  latitude: number;
  longitude: number;
  prices: FuelPrice[];
  isEvCharger: boolean;
  distanceKm?: number;
}

export interface RankedStation extends Station {
  rank: number;
  pricePence: number;
  // "Save £X on a full tank" vs the local area average benchmark.
  savingVsAverageMinor: number;
  // Extra you'd pay here vs the single cheapest option.
  extraVsCheapestMinor: number;
  navigationUrl: string; // opens turn-by-turn directions in any maps app
}

/** 'live' = real retailer/Fuel Finder data. 'mock' = bundled samples. */
export type DataSource = 'live' | 'mock';

export interface RankedResult {
  kind: FuelKind;
  tankLitres: number;
  averagePence: number | null;
  cheapestPence: number | null;
  results: RankedStation[];
  /** So the app never presents sample prices as if they were real. */
  source: DataSource;
  /** Stations known within the search radius (before price filtering). */
  stationsInRadius: number;
}

/**
 * Legacy per-retailer open-data feeds (the voluntary CMA scheme).
 *
 * IMPORTANT: that scheme's gov.uk guidance was WITHDRAWN on 1 May 2026 and
 * replaced by Fuel Finder — the statutory scheme under the Motor Fuel Price
 * (Open Data) Regulations 2025. These feeds are decaying leftovers: Asda now
 * 404s, Tesco/BP 403, Sainsbury's refuses connections, and Morrisons publishes
 * a single placeholder site in Gibraltar. Only the ones below still served real
 * UK data when last verified (2026-07-16), ~2,400 sites between them.
 *
 * Treat `aggregate` as a stopgap. The real path is FUEL_FINDER_MODE=single with
 * OAuth client credentials from https://www.developer.fuel-finder.service.gov.uk
 * (statutory, all UK forecourts, updated within 30 minutes of any change).
 */
const DEFAULT_FEEDS = [
  'https://fuel.motorfuelgroup.com/fuel_prices_data.json', // ~1223 sites
  'https://www.shell.co.uk/fuel-prices-data.html', // ~546 sites (serves JSON despite .html)
  'https://www.rontec-servicestations.co.uk/fuel-prices/data/fuel_prices_data.json', // ~265
  'https://fuelprices.esso.co.uk/latestdata.json', // ~196
  'https://applegreenstores.com/fuel-prices/data.json', // ~65
  'https://fuelprices.asconagroup.co.uk/newfuel.json', // ~60
  'https://moto-way.com/fuel-price/fuel_prices.json', // ~47
  'https://jetlocal.co.uk/fuel_prices_data.json', // ~11
];

// Several retailers' CDNs 403 a non-browser user-agent, so present as one.
const FEED_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// undici v7 does not follow redirects from `request()` — redirects moved to an
// interceptor. Shell's feed 301s, so without this it silently yields nothing.
const feedDispatcher = new Agent({ connect: { timeout: 15_000 } }).compose(
  interceptors.redirect({ maxRedirections: 3 }),
);

interface RawFeed {
  last_updated?: string;
  stations?: RawStation[];
}
interface RawStation {
  site_id: string;
  brand: string;
  address: string;
  postcode: string;
  location: { latitude: number | string; longitude: number | string };
  prices: Record<string, number>;
}

class FuelFinderClient {
  private readonly mode = env.FUEL_FINDER_MODE;
  private cache: { at: number; stations: Station[]; source: DataSource } | null = null;
  private token: { value: string; expiresAt: number } | null = null;
  /** Whether the stations last served were real or the bundled samples. */
  private lastSource: DataSource = 'mock';

  /** Diagnostics for /fuel/status — is this real data, and how much of it? */
  async status(): Promise<{
    mode: string;
    source: DataSource;
    stationCount: number;
    cachedAt: string | null;
  }> {
    const stations = await this.load();
    return {
      mode: this.mode,
      source: this.lastSource,
      stationCount: stations.length,
      cachedAt: this.cache ? new Date(this.cache.at).toISOString() : null,
    };
  }

  async nearby(params: {
    latitude: number;
    longitude: number;
    radiusKm?: number;
    evOnly?: boolean;
    limit?: number;
  }): Promise<Station[]> {
    const radiusKm = params.radiusKm ?? 15;
    const stations = await this.load();
    return stations
      .map((s) => ({ ...s, distanceKm: haversineKm(params, s) }))
      .filter((s) => s.distanceKm! <= radiusKm)
      .filter((s) => (params.evOnly ? s.isEvCharger : true))
      .sort((a, b) => a.distanceKm! - b.distanceKm!)
      .slice(0, params.limit ?? 25);
  }

  async cheapest(params: {
    latitude: number;
    longitude: number;
    kind: FuelKind;
    radiusKm?: number;
  }): Promise<Station | null> {
    const ranked = await this.ranked({ ...params, limit: 1 });
    return ranked.results[0] ?? null;
  }

  /**
   * Rank the cheapest stations for a fuel kind near a coordinate, and compute
   * how much the member saves at each vs the local average, plus how much more
   * they'd pay vs the single cheapest. Returns a maps navigation URL per site.
   */
  async ranked(params: {
    latitude: number;
    longitude: number;
    kind: FuelKind;
    radiusKm?: number;
    limit?: number;
    tankLitres?: number;
  }): Promise<RankedResult> {
    const tankLitres = params.tankLitres ?? env.DEFAULT_TANK_LITRES;
    const nearby = await this.nearby({
      latitude: params.latitude,
      longitude: params.longitude,
      radiusKm: params.radiusKm,
      evOnly: params.kind === 'ELECTRIC',
      limit: 500,
    });

    const priced = nearby
      .map((s) => ({ s, price: s.prices.find((p) => p.kind === params.kind)?.pricePence }))
      .filter((x): x is { s: Station; price: number } => x.price != null)
      .sort((a, b) => a.price - b.price);

    if (priced.length === 0) {
      return {
        kind: params.kind,
        tankLitres,
        averagePence: null,
        cheapestPence: null,
        results: [],
        source: this.lastSource,
        stationsInRadius: nearby.length,
      };
    }

    const averagePence = priced.reduce((sum, x) => sum + x.price, 0) / priced.length;
    const cheapestPence = priced[0]!.price;

    const results: RankedStation[] = priced.slice(0, params.limit ?? 3).map((x, i) => ({
      ...x.s,
      rank: i + 1,
      pricePence: x.price,
      // pence per litre × litres = pence total. Floor savings at 0.
      savingVsAverageMinor: Math.max(0, Math.round((averagePence - x.price) * tankLitres)),
      extraVsCheapestMinor: Math.round((x.price - cheapestPence) * tankLitres),
      navigationUrl: navUrl(x.s.latitude, x.s.longitude),
    }));

    return {
      kind: params.kind,
      tankLitres,
      averagePence: Math.round(averagePence * 10) / 10,
      cheapestPence,
      results,
      source: this.lastSource,
      stationsInRadius: nearby.length,
    };
  }

  // ── data loading ─────────────────────────────────────────────

  private async load(): Promise<Station[]> {
    if (this.mode === 'mock') {
      this.lastSource = 'mock';
      return SAMPLE_STATIONS;
    }

    if (this.cache && Date.now() - this.cache.at < env.FUEL_FEED_TTL_SECONDS * 1000) {
      this.lastSource = this.cache.source;
      return this.cache.stations;
    }

    const stations = this.mode === 'single' ? await this.loadSingle() : await this.loadAggregate();

    // Fall back to sample data only if a live pull returns nothing. This used to
    // happen silently, which disguised a total feed outage as a working service
    // (mock data is 8 fake London sites — so every other UK city looked "empty"
    // while London looked fine). Never silent again: log it loudly and mark the
    // source so callers can tell members the data isn't real.
    if (stations.length === 0) {
      console.error(
        `[fuel] NO LIVE DATA from mode=${this.mode} — serving ${SAMPLE_STATIONS.length} MOCK sample stations. ` +
          `Members outside London will see "no prices found".`,
      );
      this.lastSource = 'mock';
      this.cache = { at: Date.now(), stations: SAMPLE_STATIONS, source: 'mock' };
      return SAMPLE_STATIONS;
    }

    console.log(`[fuel] loaded ${stations.length} live stations (mode=${this.mode})`);
    this.lastSource = 'live';
    this.cache = { at: Date.now(), stations, source: 'live' };
    return stations;
  }

  private async loadSingle(): Promise<Station[]> {
    try {
      const bearer = await this.authToken();
      const res = await request(`${env.FUEL_FINDER_BASE_URL}/v1/prices`, {
        method: 'GET',
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      });
      if (res.statusCode >= 400) throw UpstreamError(`Fuel Finder responded ${res.statusCode}`);
      const data = (await res.body.json()) as RawFeed;
      return (data.stations ?? []).map(mapRawStation);
    } catch (err) {
      if (err instanceof Error && err.name === 'AppError') throw err;
      return [];
    }
  }

  /**
   * Resolve a bearer token for `single` mode. Prefers OAuth 2.0
   * client-credentials (client id/secret → token endpoint → access token,
   * cached until expiry); falls back to a static API key if that's what your
   * provider issued; returns null if no auth is configured.
   */
  private async authToken(): Promise<string | null> {
    // Capture into locals so TS narrowing survives the intervening calls.
    const clientId = env.FUEL_FINDER_CLIENT_ID;
    const clientSecret = env.FUEL_FINDER_CLIENT_SECRET;
    const tokenUrl = env.FUEL_FINDER_TOKEN_URL;

    // OAuth 2.0 client-credentials.
    if (clientId && clientSecret && tokenUrl) {
      if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;

      const form = new URLSearchParams({ grant_type: 'client_credentials' });
      if (env.FUEL_FINDER_SCOPE) form.set('scope', env.FUEL_FINDER_SCOPE);

      const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
      if (env.FUEL_FINDER_AUTH_STYLE === 'basic') {
        const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        headers.authorization = `Basic ${basic}`;
      } else {
        form.set('client_id', clientId);
        form.set('client_secret', clientSecret);
      }

      const res = await request(tokenUrl, {
        method: 'POST',
        headers,
        body: form.toString(),
      });
      if (res.statusCode >= 400) {
        throw UpstreamError(`Fuel Finder token endpoint responded ${res.statusCode}`);
      }
      const json = (await res.body.json()) as { access_token: string; expires_in?: number };
      this.token = {
        value: json.access_token,
        expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
      };
      return this.token.value;
    }

    // Static API key fallback.
    return env.FUEL_FINDER_API_KEY ?? null;
  }

  private async loadAggregate(): Promise<Station[]> {
    // NOTE: `??` only catches null/undefined. FUEL_RETAILER_FEEDS="" (which is
    // exactly what render.yaml sets) is a *string*, so `?.` does not
    // short-circuit — it splits to [""], filters to [], and the empty array
    // sails past `??`. Result: zero feeds fetched, zero stations, silent mock
    // fallback in production. Check for emptiness, not nullishness.
    const configured =
      env.FUEL_RETAILER_FEEDS?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    const feeds = configured.length > 0 ? configured : DEFAULT_FEEDS;

    const settled = await Promise.allSettled(feeds.map((url) => this.fetchFeed(url)));
    const stations: Station[] = [];
    settled.forEach((r, i) => {
      const host = new URL(feeds[i]!).host;
      if (r.status === 'fulfilled') {
        if (r.value.length === 0) console.warn(`[fuel] feed ${host} returned 0 stations`);
        stations.push(...r.value);
      } else {
        console.warn(`[fuel] feed ${host} failed: ${r.reason}`);
      }
    });
    return stations;
  }

  private async fetchFeed(url: string): Promise<Station[]> {
    try {
      const res = await request(url, {
        method: 'GET',
        dispatcher: feedDispatcher, // follows redirects (see feedDispatcher)
        headers: { 'user-agent': FEED_UA, accept: 'application/json,text/plain,*/*' },
      });
      if (res.statusCode >= 400) {
        console.warn(`[fuel] feed ${new URL(url).host} responded ${res.statusCode}`);
        res.body.dump();
        return [];
      }
      // Some retailers serve JSON with a text/html content-type (Shell), so
      // parse the body as text and JSON.parse it rather than trusting the type.
      const raw = await res.body.text();
      const data = JSON.parse(raw) as RawFeed;
      return (data.stations ?? []).map(mapRawStation);
    } catch (err) {
      console.warn(`[fuel] feed ${new URL(url).host} error: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }
}

function mapRawStation(r: RawStation): Station {
  const prices: FuelPrice[] = Object.entries(r.prices ?? {}).map(([kind, raw]) => ({
    kind: kind as FuelKind,
    pricePence: normalisePence(Number(raw)),
  }));
  return {
    siteId: r.site_id,
    brand: r.brand,
    address: r.address ?? '',
    postcode: r.postcode ?? '',
    latitude: Number(r.location?.latitude),
    longitude: Number(r.location?.longitude),
    prices,
    isEvCharger: prices.some((p) => p.kind === 'ELECTRIC'),
  };
}

// Retailer feeds are inconsistent: some publish pounds (1.429), some pence
// (142.9). Normalise everything to pence per litre.
function normalisePence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 10 ? Math.round(value * 1000) / 10 : Math.round(value * 10) / 10;
}

function navUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const dLat = deg2rad(b.latitude - a.latitude);
  const dLon = deg2rad(b.longitude - a.longitude);
  const lat1 = deg2rad(a.latitude);
  const lat2 = deg2rad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return R * 2 * Math.asin(Math.sqrt(h));
}

const deg2rad = (d: number): number => (d * Math.PI) / 180;

export const fuelFinder = new FuelFinderClient();
