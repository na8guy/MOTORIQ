/**
 * UK clean-air and congestion charging zones.
 *
 * Getting caught by a ULEZ charge you didn't know about costs £12.50 a day,
 * and the penalty for not paying is £180. That makes this one of the few
 * features where the app can save someone real money by saying "don't drive
 * there in this car".
 *
 * ── WHY THE ZONES ARE BUNDLED, NOT FETCHED ──
 * There is no single national API for clean-air zones. TfL publishes its own,
 * each city runs its own scheme, and the charging rules are legislation rather
 * than data. So the boundaries and prices are held here, versioned in code,
 * with the date each was last checked against the operator's published rules.
 *
 * The boundaries are deliberately approximate — a bounding circle, not a
 * polygon — which is honest about precision: we tell a member they are *near
 * or inside* a zone and link to the operator's own checker for the definitive
 * answer. Claiming street-level accuracy we don't have would be worse than
 * useless when the penalty is £180.
 *
 * Charges verified against operator pages on 2026-07-17. Re-check on the
 * `reviewBy` date on each zone.
 */

export type ZoneKind = 'ULEZ' | 'CAZ' | 'CONGESTION' | 'LEZ';

export interface CleanAirZone {
  id: string;
  name: string;
  kind: ZoneKind;
  operator: string;
  /** Approximate centre and radius. See the note above on precision. */
  latitude: number;
  longitude: number;
  radiusKm: number;
  /** Daily charge in pence for a non-compliant car. */
  dailyChargeMinor: number;
  /** Charge for a non-compliant van/LGV, where different. */
  vanChargeMinor?: number;
  /** Hours of operation in plain words. */
  hours: string;
  /** What makes a vehicle exempt. */
  exemption: string;
  /** The operator's own definitive checker. */
  checkUrl: string;
  /** When these figures were last verified. */
  verified: string;
  reviewBy: string;
}

export const ZONES: CleanAirZone[] = [
  {
    id: 'london-ulez',
    name: 'London ULEZ',
    kind: 'ULEZ',
    operator: 'Transport for London',
    latitude: 51.5074,
    longitude: -0.1278,
    // London-wide since Aug 2023 — out to the M25 boundary.
    radiusKm: 30,
    dailyChargeMinor: 1250,
    vanChargeMinor: 1250,
    hours: 'Every day except Christmas Day, 24 hours',
    exemption: 'Petrol Euro 4 (roughly 2006 on) and diesel Euro 6 (roughly 2015 on) are free',
    checkUrl: 'https://tfl.gov.uk/modes/driving/check-your-vehicle/',
    verified: '2026-07-17',
    reviewBy: '2027-01-01',
  },
  {
    id: 'london-congestion',
    name: 'London Congestion Charge',
    kind: 'CONGESTION',
    operator: 'Transport for London',
    latitude: 51.5115,
    longitude: -0.1265,
    radiusKm: 3.5,
    dailyChargeMinor: 1500,
    hours: 'Mon–Fri 07:00–18:00, Sat–Sun 12:00–18:00. Free 25 Dec–1 Jan',
    exemption: 'Residents get 90% off; some electric vehicles are discounted',
    checkUrl: 'https://tfl.gov.uk/modes/driving/congestion-charge',
    verified: '2026-07-17',
    reviewBy: '2027-01-01',
  },
  {
    id: 'birmingham-caz',
    name: 'Birmingham Clean Air Zone',
    kind: 'CAZ',
    operator: 'Birmingham City Council',
    latitude: 52.4796,
    longitude: -1.9026,
    radiusKm: 1.6,
    dailyChargeMinor: 800,
    vanChargeMinor: 5000,
    hours: 'Every day, 24 hours',
    exemption: 'Petrol Euro 4 and diesel Euro 6 are free',
    checkUrl: 'https://www.gov.uk/clean-air-zones',
    verified: '2026-07-17',
    reviewBy: '2027-01-01',
  },
  {
    id: 'bristol-caz',
    name: 'Bristol Clean Air Zone',
    kind: 'CAZ',
    operator: 'Bristol City Council',
    latitude: 51.4545,
    longitude: -2.5879,
    radiusKm: 1.5,
    dailyChargeMinor: 900,
    vanChargeMinor: 900,
    hours: 'Every day, 24 hours',
    exemption: 'Petrol Euro 4 and diesel Euro 6 are free',
    checkUrl: 'https://www.gov.uk/clean-air-zones',
    verified: '2026-07-17',
    reviewBy: '2027-01-01',
  },
  {
    id: 'sheffield-caz',
    name: 'Sheffield Clean Air Zone',
    kind: 'CAZ',
    operator: 'Sheffield City Council',
    latitude: 53.3811,
    longitude: -1.4701,
    radiusKm: 1.4,
    // Class C: vans, taxis, buses and HGVs — private cars are NOT charged.
    dailyChargeMinor: 0,
    vanChargeMinor: 1000,
    hours: 'Every day, 24 hours',
    exemption: 'Private cars are not charged in Sheffield',
    checkUrl: 'https://www.gov.uk/clean-air-zones',
    verified: '2026-07-17',
    reviewBy: '2027-01-01',
  },
  {
    id: 'glasgow-lez',
    name: 'Glasgow Low Emission Zone',
    kind: 'LEZ',
    operator: 'Glasgow City Council',
    latitude: 55.8609,
    longitude: -4.2514,
    radiusKm: 1.2,
    // Scotland fines rather than charges: £60, doubling on each repeat.
    dailyChargeMinor: 6000,
    hours: 'Every day, 24 hours',
    exemption: 'Petrol Euro 4 and diesel Euro 6 may enter. Others are fined, not charged',
    checkUrl: 'https://www.lowemissionzones.scot/',
    verified: '2026-07-17',
    reviewBy: '2027-01-01',
  },
  {
    id: 'oxford-zez',
    name: 'Oxford Zero Emission Zone',
    kind: 'CAZ',
    operator: 'Oxfordshire County Council',
    latitude: 51.7520,
    longitude: -1.2577,
    radiusKm: 0.5,
    dailyChargeMinor: 1000,
    hours: 'Every day 07:00–19:00',
    exemption: 'Only fully electric and hydrogen vehicles are free',
    checkUrl: 'https://www.oxford.gov.uk/zeroemissionzone',
    verified: '2026-07-17',
    reviewBy: '2027-01-01',
  },
];

export interface ZoneCheck {
  zone: CleanAirZone;
  distanceKm: number;
  /** Inside the approximate boundary. */
  inside: boolean;
  /** Within 5km of the edge — worth warning about on a route. */
  nearby: boolean;
  /** Our best guess for THIS vehicle, or null when we can't tell. */
  likelyCharge: {
    chargeMinor: number;
    /** Why we think so — always shown, never just a number. */
    reason: string;
    /** How sure we are. Never "certain": the operator decides, not us. */
    confidence: 'likely-exempt' | 'likely-charged' | 'unknown';
  } | null;
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

/**
 * Estimate whether a vehicle is charged in a zone.
 *
 * Uses the Euro-standard rules of thumb — petrol from ~2006 and diesel from
 * ~2015 are generally compliant — because the real Euro standard isn't in the
 * DVLA data we hold. That's a heuristic, and it's labelled as one: the result
 * always carries a confidence and a link to the operator's own checker, since
 * being wrong here costs the member £180.
 */
function assessVehicle(
  zone: CleanAirZone,
  vehicle?: { fuelType?: string | null; year?: number | null },
): ZoneCheck['likelyCharge'] {
  const carCharge = zone.dailyChargeMinor;
  if (carCharge === 0) {
    return { chargeMinor: 0, reason: `${zone.name} does not charge private cars`, confidence: 'likely-exempt' };
  }
  if (!vehicle?.fuelType || !vehicle.year) {
    return { chargeMinor: carCharge, reason: 'Add your vehicle to see whether you would be charged', confidence: 'unknown' };
  }

  const fuel = vehicle.fuelType.toUpperCase();
  if (fuel === 'ELECTRIC') {
    return { chargeMinor: 0, reason: 'Electric vehicles are exempt', confidence: 'likely-exempt' };
  }
  if (zone.id === 'oxford-zez') {
    return {
      chargeMinor: carCharge,
      reason: 'Oxford charges everything except fully electric and hydrogen vehicles',
      confidence: 'likely-charged',
    };
  }

  const isDiesel = fuel === 'DIESEL';
  const threshold = isDiesel ? 2015 : 2006; // Euro 6 diesel / Euro 4 petrol
  if (vehicle.year >= threshold) {
    return {
      chargeMinor: 0,
      reason: `${isDiesel ? 'Diesel' : 'Petrol'} from ${vehicle.year} is usually ${isDiesel ? 'Euro 6' : 'Euro 4'} compliant`,
      confidence: 'likely-exempt',
    };
  }
  return {
    chargeMinor: carCharge,
    reason: `${isDiesel ? 'Diesels' : 'Petrol cars'} before ${threshold} are usually charged`,
    confidence: 'likely-charged',
  };
}

/** Zones at or near a point, nearest first. */
export function checkLocation(params: {
  latitude: number;
  longitude: number;
  vehicle?: { fuelType?: string | null; year?: number | null };
  /** How far out to warn, in km. */
  warnWithinKm?: number;
}): ZoneCheck[] {
  const warn = params.warnWithinKm ?? 5;
  const here = { lat: params.latitude, lng: params.longitude };

  return ZONES.map((zone) => {
    const distanceKm = haversineKm(here, { lat: zone.latitude, lng: zone.longitude });
    const inside = distanceKm <= zone.radiusKm;
    return {
      zone,
      distanceKm: Math.round(distanceKm * 10) / 10,
      inside,
      nearby: !inside && distanceKm <= zone.radiusKm + warn,
      likelyCharge: assessVehicle(zone, params.vehicle),
    };
  })
    .filter((c) => c.inside || c.nearby)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Zones crossed on a journey, and what the day would cost.
 *
 * Samples the straight line between the two points. That will miss a zone a
 * winding route clips and may flag one the road actually bypasses — so it is
 * presented as "zones on your way", not a bill.
 */
export function checkRoute(params: {
  from: { latitude: number; longitude: number };
  to: { latitude: number; longitude: number };
  vehicle?: { fuelType?: string | null; year?: number | null };
}): { zones: ZoneCheck[]; totalChargeMinor: number } {
  const samples = 24;
  const seen = new Map<string, ZoneCheck>();

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const lat = params.from.latitude + (params.to.latitude - params.from.latitude) * t;
    const lng = params.from.longitude + (params.to.longitude - params.from.longitude) * t;
    for (const check of checkLocation({ latitude: lat, longitude: lng, vehicle: params.vehicle, warnWithinKm: 0 })) {
      if (check.inside && !seen.has(check.zone.id)) seen.set(check.zone.id, check);
    }
  }

  const zones = [...seen.values()];
  // Each zone charges once per day, so this is a daily total, not per crossing.
  const totalChargeMinor = zones.reduce((sum, z) => sum + (z.likelyCharge?.chargeMinor ?? 0), 0);
  return { zones, totalChargeMinor };
}
