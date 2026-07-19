import { request } from 'undici';
import { env } from '../../config/env.js';

/**
 * Drive-time estimates, so members see "4 min away" rather than a straight-line
 * distance that ignores the river between them and the forecourt.
 *
 * Uses OSRM. The public demo server is free and needs no key, but its usage
 * policy explicitly forbids heavy production traffic — before real volume,
 * either self-host OSRM (it's open source) or move to a paid router, and point
 * OSRM_BASE_URL at it.
 *
 * When routing is unavailable we fall back to estimating from the straight-line
 * distance rather than showing nothing. That estimate is deliberately
 * conservative and flagged (`estimated: true`) so the app can hedge the wording.
 */

export interface DriveTime {
  /** Seconds behind the wheel. */
  seconds: number;
  /** Road distance in metres (straight-line × detour factor when estimated). */
  metres: number;
  /** True when this came from a real route; false when we guessed from distance. */
  routed: boolean;
}

/**
 * Typical door-to-door average once junctions, lights and turns are accounted
 * for. Urban UK driving averages well under the speed limit; 30 km/h is a
 * realistic blended figure for the short hops this is used for.
 */
const ASSUMED_KMH = 30;

/**
 * Roads are never straight. Multiplying great-circle distance by ~1.35 is the
 * standard detour factor for road networks and beats pretending it's a straight
 * line — which would promise a 2-minute drive that actually takes 5.
 */
const DETOUR_FACTOR = 1.35;

/** Fallback estimate from crow-flies distance. */
export function estimateDriveTime(straightLineKm: number): DriveTime {
  const roadKm = straightLineKm * DETOUR_FACTOR;
  return {
    seconds: Math.round((roadKm / ASSUMED_KMH) * 3600),
    metres: Math.round(roadKm * 1000),
    routed: false,
  };
}

/**
 * Real drive times from one origin to many destinations in a single request.
 *
 * Uses OSRM's `table` service rather than N `route` calls: one request for 20
 * stations instead of 20, which matters both for latency and for staying inside
 * the demo server's fair-use limits.
 *
 * Never throws — routing is a nice-to-have on top of prices, so a router outage
 * must degrade to estimates rather than break the fuel list.
 */
export async function driveTimes(
  origin: { lat: number; lng: number },
  destinations: { lat: number; lng: number }[],
): Promise<(DriveTime | null)[]> {
  if (destinations.length === 0) return [];

  if (!env.ROUTING_ENABLED) return destinations.map(() => null);

  try {
    // OSRM wants lng,lat (not lat,lng) — reversing these silently routes you
    // into the sea, and it still returns a plausible-looking duration.
    const coords = [origin, ...destinations].map((p) => `${p.lng},${p.lat}`).join(';');
    const destIdx = destinations.map((_, i) => i + 1).join(';');
    const url =
      `${env.OSRM_BASE_URL}/table/v1/driving/${coords}` +
      `?sources=0&destinations=${destIdx}&annotations=duration,distance`;

    const res = await request(url, {
      method: 'GET',
      headers: { 'user-agent': 'SaveOnDrive/1.0' },
      headersTimeout: 8000,
      bodyTimeout: 8000,
    });

    if (res.statusCode >= 400) {
      res.body.dump();
      console.warn(`[routing] OSRM responded ${res.statusCode}`);
      return destinations.map(() => null);
    }

    const data = (await res.body.json()) as {
      code?: string;
      durations?: (number | null)[][];
      distances?: (number | null)[][];
    };
    if (data.code !== 'Ok' || !data.durations?.[0]) {
      console.warn(`[routing] OSRM returned code=${data.code}`);
      return destinations.map(() => null);
    }

    const durations = data.durations[0];
    const distances = data.distances?.[0];

    return destinations.map((_, i) => {
      const seconds = durations[i];
      if (seconds == null) return null; // unroutable (e.g. island, bad geocode)
      return {
        seconds: Math.round(seconds),
        metres: Math.round(distances?.[i] ?? 0),
        routed: true,
      };
    });
  } catch (err) {
    console.warn(`[routing] failed: ${err instanceof Error ? err.message : err}`);
    return destinations.map(() => null);
  }
}
