import { request } from 'undici';
import OpeningHours from 'opening_hours';

/**
 * Opening hours for forecourts, from OpenStreetMap via the Overpass API
 * (free, no key).
 *
 * WHY OSM: the retailer price feeds publish prices and nothing else — no hours.
 * The statutory Fuel Finder API does include opening hours, so once
 * FUEL_FINDER_MODE=single is credentialed this becomes a fallback rather than
 * the primary source.
 *
 * COVERAGE IS PARTIAL AND ALWAYS WILL BE. OSM is contributor-maintained: only
 * roughly a third of UK forecourts carry an `opening_hours` tag. Sites without
 * one are reported as unknown, never guessed — telling someone a station is
 * open when it's shut at 11pm is worse than admitting we don't know.
 *
 * Overpass is a shared free service with strict fair-use limits, so results are
 * cached hard (hours change rarely) and queried per area, never per station.
 */

export interface OpeningInfo {
  /** Raw OSM opening_hours value, e.g. "Mo-Sa 06:30-22:30; Su 08:00-22:00". */
  raw: string;
  /** Open right now? null when the value can't be parsed. */
  isOpen: boolean | null;
  /** Next open/close boundary, ISO. Null for 24/7 or unparseable. */
  nextChange: string | null;
  /** True for "24/7". */
  isAlwaysOpen: boolean;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
/** OSM hours change rarely; Overpass is a shared free service. Cache hard. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** How close an OSM node must be to a feed station to be the same forecourt. */
const MATCH_RADIUS_M = 200;

interface CachedArea {
  at: number;
  nodes: { lat: number; lng: number; hours: string }[];
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Interpret an OSM opening_hours value for right now. */
export function interpret(raw: string, lat: number, lng: number): OpeningInfo {
  const trimmed = raw.trim();
  if (trimmed === '24/7') {
    return { raw: trimmed, isOpen: true, nextChange: null, isAlwaysOpen: true };
  }
  try {
    // country_code drives public-holiday rules; `state` is required by the
    // type but only used for regional holidays we don't model, so it's blank.
    const oh = new OpeningHours(trimmed, {
      lat,
      lon: lng,
      address: { country_code: 'gb', state: '' },
    });
    const now = new Date();
    const next = oh.getNextChange(now) as Date | undefined;
    return {
      raw: trimmed,
      isOpen: oh.getState(now) as boolean,
      nextChange: next ? next.toISOString() : null,
      isAlwaysOpen: false,
    };
  } catch {
    // Unparseable syntax — show the raw text and admit we don't know the state.
    return { raw: trimmed, isOpen: null, nextChange: null, isAlwaysOpen: false };
  }
}

class OsmHoursClient {
  private cache = new Map<string, CachedArea>();

  /**
   * Opening hours for a set of stations, keyed by the caller's own id.
   * Stations OSM knows nothing about are simply absent from the map.
   *
   * Never throws: hours are a bonus on top of prices, so an Overpass outage
   * must not take the fuel list down with it.
   */
  async forStations(
    stations: { id: string; lat: number; lng: number }[],
  ): Promise<Map<string, OpeningInfo>> {
    const out = new Map<string, OpeningInfo>();
    if (stations.length === 0) return out;

    const lats = stations.map((s) => s.lat);
    const lngs = stations.map((s) => s.lng);
    // Pad the bbox so stations on the edge still match a node just outside it.
    const pad = 0.01; // ~1.1km
    const bbox = {
      south: Math.min(...lats) - pad,
      west: Math.min(...lngs) - pad,
      north: Math.max(...lats) + pad,
      east: Math.max(...lngs) + pad,
    };

    const nodes = await this.fetchArea(bbox);
    if (nodes.length === 0) return out;

    for (const s of stations) {
      let best: { hours: string; dist: number } | null = null;
      for (const n of nodes) {
        const d = haversineM({ lat: s.lat, lng: s.lng }, { lat: n.lat, lng: n.lng });
        if (d <= MATCH_RADIUS_M && (!best || d < best.dist)) {
          best = { hours: n.hours, dist: d };
        }
      }
      if (best) out.set(s.id, interpret(best.hours, s.lat, s.lng));
    }
    return out;
  }

  private async fetchArea(bbox: {
    south: number;
    west: number;
    north: number;
    east: number;
  }): Promise<CachedArea['nodes']> {
    // Round the key so slightly different searches in the same town share a
    // cache entry instead of hammering Overpass.
    const key = [bbox.south, bbox.west, bbox.north, bbox.east]
      .map((v) => v.toFixed(2))
      .join(',');
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.nodes;

    // Ask only for fuel features that actually carry an opening_hours tag —
    // anything else is weight we'd throw away.
    const q =
      `[out:json][timeout:20];` +
      `(node["amenity"="fuel"]["opening_hours"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
      `way["amenity"="fuel"]["opening_hours"](${bbox.south},${bbox.west},${bbox.north},${bbox.east}););` +
      `out center tags;`;

    try {
      const res = await request(`${OVERPASS_URL}?data=${encodeURIComponent(q)}`, {
        method: 'GET',
        headers: { 'user-agent': 'SaveOnDrive/1.0 (+https://saveondrive.co.uk)' },
        headersTimeout: 20_000,
        bodyTimeout: 20_000,
      });
      if (res.statusCode >= 400) {
        res.body.dump();
        console.warn(`[hours] Overpass responded ${res.statusCode}`);
        return [];
      }
      const data = (await res.body.json()) as { elements?: OverpassElement[] };
      const nodes = (data.elements ?? [])
        .map((e) => {
          const lat = e.lat ?? e.center?.lat;
          const lon = e.lon ?? e.center?.lon;
          const hours = e.tags?.opening_hours;
          if (lat == null || lon == null || !hours) return null;
          return { lat, lng: lon, hours };
        })
        .filter((n): n is CachedArea['nodes'][number] => n !== null);

      this.cache.set(key, { at: Date.now(), nodes });
      console.log(`[hours] Overpass: ${nodes.length} forecourts with opening hours in ${key}`);
      return nodes;
    } catch (err) {
      console.warn(`[hours] Overpass failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }
}

export const osmHours = new OsmHoursClient();
