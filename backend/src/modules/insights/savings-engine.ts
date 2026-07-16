import { prisma } from '../../lib/prisma.js';
import { fuelFinder, type FuelKind } from '../../integrations/fuelfinder/fuelfinder.client.js';

/**
 * The savings engine. The *calculation* of how much a member saves is
 * deterministic arithmetic — we compare the price they paid against the
 * local benchmark (area-average pump price for that fuel) and multiply by
 * the volume purchased. AI is layered on top (see ai/insights.ts) to turn
 * these numbers into a personalised narrative and recommendations.
 */

export type Period = 'daily' | 'weekly' | 'monthly';

export interface RecordPurchaseInput {
  userId: string;
  vehicleId?: string;
  fuelKind: FuelKind;
  litres: number;
  pricePencePerUnit: number;
  stationBrand?: string;
  stationPostcode?: string;
  latitude?: number;
  longitude?: number;
  purchasedAt?: Date;
}

/** Area-average price for a fuel kind near a coordinate (the benchmark). */
async function benchmarkPrice(
  kind: FuelKind,
  lat?: number,
  lng?: number,
): Promise<number | null> {
  if (lat == null || lng == null) return null;
  const stations = await fuelFinder.nearby({
    latitude: lat,
    longitude: lng,
    evOnly: kind === 'ELECTRIC',
    limit: 100,
  });
  const prices = stations
    .map((s) => s.prices.find((p) => p.kind === kind)?.pricePence)
    .filter((p): p is number => p != null);
  if (prices.length === 0) return null;
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

export async function recordPurchase(input: RecordPurchaseInput) {
  const benchmark = await benchmarkPrice(input.fuelKind, input.latitude, input.longitude);
  const totalMinor = Math.round(input.litres * input.pricePencePerUnit);
  // Saving vs benchmark (pence). Positive = cheaper than local average.
  const savedMinor =
    benchmark != null ? Math.round((benchmark - input.pricePencePerUnit) * input.litres) : 0;

  return prisma.fuelPurchase.create({
    data: {
      userId: input.userId,
      vehicleId: input.vehicleId,
      fuelKind: input.fuelKind,
      litres: input.litres,
      pricePencePerUnit: input.pricePencePerUnit,
      totalMinor,
      stationBrand: input.stationBrand,
      stationPostcode: input.stationPostcode,
      latitude: input.latitude,
      longitude: input.longitude,
      benchmarkPencePerUnit: benchmark ?? undefined,
      savedMinor,
      purchasedAt: input.purchasedAt ?? new Date(),
      // Logged by hand, so it's a statement of fact rather than an intent —
      // counts immediately. Intents created by "Navigate here" go through
      // savings/purchase-confirmation.service.ts and start life PENDING.
      status: 'CONFIRMED',
      confirmationSource: 'MANUAL',
      confirmedAt: new Date(),
    },
  });
}

// ── Rollups ──────────────────────────────────────────────────

function bucketKey(date: Date, period: Period): string {
  const d = new Date(date);
  if (period === 'daily') return d.toISOString().slice(0, 10); // YYYY-MM-DD
  if (period === 'monthly') return d.toISOString().slice(0, 7); // YYYY-MM
  // weekly: ISO week start (Monday)
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export interface SavingsBucket {
  bucket: string;
  savedMinor: number;
  spentMinor: number;
  litres: number;
  purchases: number;
}

export interface SavingsSummary {
  period: Period;
  totalSavedMinor: number;
  totalSpentMinor: number;
  totalLitres: number;
  purchaseCount: number;
  projectedAnnualSavingMinor: number;
  series: SavingsBucket[];
}

const HORIZON_DAYS: Record<Period, number> = { daily: 30, weekly: 84, monthly: 365 };

export async function savingsSummary(userId: string, period: Period): Promise<SavingsSummary> {
  const since = new Date(Date.now() - HORIZON_DAYS[period] * 24 * 3600 * 1000);
  const purchases = await prisma.fuelPurchase.findMany({
    // CONFIRMED only. A PENDING row is just "they tapped Navigate" — counting
    // it would report savings for fuel that may never have been bought. See
    // savings/purchase-confirmation.service.ts.
    where: { userId, status: 'CONFIRMED', purchasedAt: { gte: since } },
    orderBy: { purchasedAt: 'asc' },
  });

  const buckets = new Map<string, SavingsBucket>();
  let totalSavedMinor = 0;
  let totalSpentMinor = 0;
  let totalLitres = 0;

  for (const p of purchases) {
    const key = bucketKey(p.purchasedAt, period);
    const b = buckets.get(key) ?? { bucket: key, savedMinor: 0, spentMinor: 0, litres: 0, purchases: 0 };
    b.savedMinor += p.savedMinor;
    b.spentMinor += p.totalMinor;
    b.litres += p.litres;
    b.purchases += 1;
    buckets.set(key, b);
    totalSavedMinor += p.savedMinor;
    totalSpentMinor += p.totalMinor;
    totalLitres += p.litres;
  }

  const series = [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));

  // Project annual saving from the observed daily rate over the horizon.
  const spanDays = Math.max(1, HORIZON_DAYS[period]);
  const projectedAnnualSavingMinor = Math.round((totalSavedMinor / spanDays) * 365);

  return {
    period,
    totalSavedMinor,
    totalSpentMinor,
    totalLitres: Math.round(totalLitres * 100) / 100,
    purchaseCount: purchases.length,
    projectedAnnualSavingMinor,
    series,
  };
}
