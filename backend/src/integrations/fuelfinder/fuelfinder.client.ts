import { request } from 'undici';
import { env } from '../../config/env.js';
import { UpstreamError } from '../../lib/errors.js';
import { SAMPLE_STATIONS } from './sample-data.js';

/**
 * UK Fuel Finder (DESNZ) client.
 * https://www.developer.fuel-finder.service.gov.uk
 *
 * Fuel Finder is the permanent open-data scheme replacing the interim
 * CMA voluntary scheme. Traders must submit price updates within 30
 * minutes of a change. The response shape below follows the established
 * open fuel-price JSON schema (site_id / brand / location / prices with
 * E10, E5, B7, SDV keys). Confirm exact paths + auth once you are
 * registered for API access.
 *
 * When FUEL_FINDER_MOCK=true (default) we serve bundled sample stations
 * so fuel/EV features work without live API access.
 */

export type FuelKind = 'E10' | 'E5' | 'B7' | 'SDV' | 'ELECTRIC';

export interface FuelPrice {
  kind: FuelKind;
  // Price in pence per litre (or per kWh for ELECTRIC).
  pricePence: number;
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

class FuelFinderClient {
  private readonly mock = env.FUEL_FINDER_MOCK;

  /**
   * Return stations near a coordinate, sorted by distance, optionally
   * filtered to EV chargers only.
   */
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

  /** Cheapest station for a given fuel kind near a coordinate. */
  async cheapest(params: {
    latitude: number;
    longitude: number;
    kind: FuelKind;
    radiusKm?: number;
  }): Promise<Station | null> {
    const stations = await this.nearby({
      latitude: params.latitude,
      longitude: params.longitude,
      radiusKm: params.radiusKm,
      evOnly: params.kind === 'ELECTRIC',
      limit: 500,
    });
    const withPrice = stations
      .map((s) => ({ s, price: s.prices.find((p) => p.kind === params.kind)?.pricePence }))
      .filter((x): x is { s: Station; price: number } => x.price != null)
      .sort((a, b) => a.price - b.price);
    return withPrice[0]?.s ?? null;
  }

  private async load(): Promise<Station[]> {
    if (this.mock) return SAMPLE_STATIONS;

    try {
      const res = await request(`${env.FUEL_FINDER_BASE_URL}/v1/prices`, {
        method: 'GET',
        headers: env.FUEL_FINDER_API_KEY
          ? { authorization: `Bearer ${env.FUEL_FINDER_API_KEY}` }
          : {},
      });
      if (res.statusCode >= 400) {
        throw UpstreamError(`Fuel Finder responded ${res.statusCode}`);
      }
      const data = (await res.body.json()) as { stations?: RawStation[] };
      return (data.stations ?? []).map(mapRawStation);
    } catch (err) {
      if (err instanceof Error && err.name === 'AppError') throw err;
      throw UpstreamError('Fuel Finder request failed', String(err));
    }
  }
}

interface RawStation {
  site_id: string;
  brand: string;
  address: string;
  postcode: string;
  location: { latitude: number; longitude: number };
  prices: Record<string, number>; // e.g. { E10: 142.9, B7: 149.9 } in pence
}

function mapRawStation(r: RawStation): Station {
  const prices: FuelPrice[] = Object.entries(r.prices).map(([kind, pricePence]) => ({
    kind: kind as FuelKind,
    pricePence,
  }));
  return {
    siteId: r.site_id,
    brand: r.brand,
    address: r.address,
    postcode: r.postcode,
    latitude: r.location.latitude,
    longitude: r.location.longitude,
    prices,
    isEvCharger: prices.some((p) => p.kind === 'ELECTRIC'),
  };
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
