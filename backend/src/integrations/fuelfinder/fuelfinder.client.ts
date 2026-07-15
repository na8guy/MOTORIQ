import { request } from 'undici';
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

export interface RankedResult {
  kind: FuelKind;
  tankLitres: number;
  averagePence: number | null;
  cheapestPence: number | null;
  results: RankedStation[];
}

// Well-known UK open fuel-price retailer feeds (CMA / Fuel Finder scheme).
const DEFAULT_FEEDS = [
  'https://storelocator.asda.com/fuel_prices/fuel_prices_data.json',
  'https://www.bp.com/en_gb/united-kingdom/home/fuelprices/fuel_prices_data.json',
  'https://api.sainsburys.co.uk/v1/exports/latest/fuel_prices_data.json',
  'https://www.tesco.com/fuel_prices/fuel_prices_data.json',
  'https://www.morrisons.com/fuel-prices/fuel.json',
  'https://fuelprices.esso.co.uk/latestdata.json',
  'https://applegreenstores.com/fuel-prices/data.json',
  'https://fuel.motorfuelgroup.com/fuel_prices_data.json',
];

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
  private cache: { at: number; stations: Station[] } | null = null;
  private token: { value: string; expiresAt: number } | null = null;

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
      return { kind: params.kind, tankLitres, averagePence: null, cheapestPence: null, results: [] };
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
    };
  }

  // ── data loading ─────────────────────────────────────────────

  private async load(): Promise<Station[]> {
    if (this.mode === 'mock') return SAMPLE_STATIONS;

    if (this.cache && Date.now() - this.cache.at < env.FUEL_FEED_TTL_SECONDS * 1000) {
      return this.cache.stations;
    }

    const stations = this.mode === 'single' ? await this.loadSingle() : await this.loadAggregate();
    // Fall back to sample data if a live pull returns nothing (network down).
    const finalStations = stations.length > 0 ? stations : SAMPLE_STATIONS;
    this.cache = { at: Date.now(), stations: finalStations };
    return finalStations;
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
    const feeds = (env.FUEL_RETAILER_FEEDS?.split(',').map((s) => s.trim()).filter(Boolean) ?? DEFAULT_FEEDS);
    const settled = await Promise.allSettled(feeds.map((url) => this.fetchFeed(url)));
    const stations: Station[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') stations.push(...r.value);
    }
    return stations;
  }

  private async fetchFeed(url: string): Promise<Station[]> {
    try {
      const res = await request(url, { method: 'GET', headers: { 'user-agent': 'MOTORIQ/1.0' } });
      if (res.statusCode >= 400) return [];
      const data = (await res.body.json()) as RawFeed;
      return (data.stations ?? []).map(mapRawStation);
    } catch {
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
