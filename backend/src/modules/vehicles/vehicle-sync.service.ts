import type { FuelType, Prisma } from '@prisma/client';
import { dvla, type VehicleLookup } from '../../integrations/dvla/dvla.client.js';
import { prisma } from '../../lib/prisma.js';

/**
 * Keeps a member's vehicle in step with government data and turns the dates it
 * returns into reminders automatically, so nobody has to type an MOT date in.
 *
 * Only MOT and road tax can be automated — see dvla.client.ts for why insurance
 * and servicing cannot be (no public API exists for either).
 */

/** Map DVLA/DVSA fuel descriptions onto our FuelType enum. */
function mapFuelType(raw: string | null): FuelType | null {
  if (!raw) return null;
  const v = raw.toUpperCase();
  if (v.includes('ELECTRIC')) return 'ELECTRIC'; // VES says "ELECTRICITY"
  if (v.includes('DIESEL')) return 'DIESEL';
  if (v.includes('PLUG')) return 'PLUGIN_HYBRID';
  if (v.includes('HYBRID')) return 'HYBRID';
  if (v.includes('GAS') || v.includes('LPG')) return 'LPG';
  if (v.includes('PETROL')) return 'PETROL';
  return null;
}

function toDate(iso: string | null): Date | null {
  return iso ? new Date(iso) : null;
}

/**
 * Fetch government data for a vehicle and persist it.
 *
 * `preferLookup` decides who wins when both the member and the DVLA have a
 * value. On first add the DVLA is authoritative; on a later refresh we don't
 * clobber details the member has since corrected — except the MOT/tax dates,
 * which are always the DVLA's to own.
 */
export async function syncVehicle(
  vehicleId: string,
  opts: { preferLookup?: boolean } = {},
): Promise<{ vehicle: Prisma.VehicleGetPayload<object>; lookup: VehicleLookup }> {
  const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
  const lookup = await dvla.lookup(vehicle.registration);

  const prefer = opts.preferLookup ?? false;
  const pick = <T>(existing: T | null, fresh: T | null): T | null =>
    prefer ? (fresh ?? existing) : (existing ?? fresh);

  const fuel = mapFuelType(lookup.fuelType);

  const updated = await prisma.vehicle.update({
    where: { id: vehicleId },
    data: {
      make: pick(vehicle.make, lookup.make),
      model: pick(vehicle.model, lookup.model),
      colour: pick(vehicle.colour, lookup.colour),
      year: pick(vehicle.year, lookup.year),
      // Never overwrite a member's own odometer reading with an older MOT one.
      mileage: vehicle.mileage ?? lookup.mileage,
      ...(fuel && prefer ? { fuelType: fuel } : {}),
      // Government-owned facts: always take the freshest value.
      taxStatus: lookup.taxStatus,
      taxDueDate: toDate(lookup.taxDueDate),
      motStatus: lookup.motStatus,
      motExpiryDate: toDate(lookup.motExpiryDate),
      dvlaSyncedAt: new Date(),
      dvlaSyncError: lookup.error ?? null,
    },
  });

  await syncReminders(updated.userId, updated.id, {
    MOT: toDate(lookup.motExpiryDate),
    ROAD_TAX: toDate(lookup.taxDueDate),
  });

  return { vehicle: updated, lookup };
}

/**
 * Create or move the automatic reminders for a vehicle.
 *
 * Idempotent by (vehicleId, type): re-syncing moves the existing reminder
 * rather than piling up duplicates every night. A reminder the member already
 * completed for a *past* date is left alone, but a new future date revives it —
 * that's the annual renewal coming round again.
 */
async function syncReminders(
  userId: string,
  vehicleId: string,
  dates: { MOT: Date | null; ROAD_TAX: Date | null },
): Promise<void> {
  for (const [type, dueDate] of Object.entries(dates) as ['MOT' | 'ROAD_TAX', Date | null][]) {
    const existing = await prisma.reminder.findFirst({ where: { vehicleId, type } });

    if (!dueDate) {
      // No date available (e.g. SORN, or no MOT history yet) — drop a stale
      // auto-reminder rather than leaving a wrong date on screen.
      if (existing?.note?.startsWith(AUTO_NOTE_PREFIX)) {
        await prisma.reminder.delete({ where: { id: existing.id } });
      }
      continue;
    }

    const note = `${AUTO_NOTE_PREFIX}${type === 'MOT' ? 'MOT expires' : 'Road tax due'} — from ${
      type === 'MOT' ? 'DVSA MOT History' : 'DVLA'
    }`;

    if (!existing) {
      await prisma.reminder.create({ data: { userId, vehicleId, type, dueDate, note } });
      continue;
    }

    const moved = existing.dueDate.getTime() !== dueDate.getTime();
    if (moved) {
      await prisma.reminder.update({
        where: { id: existing.id },
        data: { dueDate, note, completed: false },
      });
    }
  }
}

/** Marks a reminder as government-sourced, so we know we may manage it. */
const AUTO_NOTE_PREFIX = 'Auto: ';

/**
 * Refresh every vehicle's government data. Intended for a daily scheduled run
 * so tax/MOT dates stay current without the member opening the app.
 *
 * Sequential and deliberately unhurried: DVLA/DVSA rate-limit, and this has all
 * night to finish. One vehicle failing must not abort the rest.
 */
export async function refreshAllVehicles(): Promise<{ synced: number; failed: number }> {
  const vehicles = await prisma.vehicle.findMany({ select: { id: true } });
  let synced = 0;
  let failed = 0;
  for (const v of vehicles) {
    try {
      await syncVehicle(v.id);
      synced++;
    } catch (err) {
      failed++;
      console.error(`[vehicle-sync] ${v.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[vehicle-sync] refreshed ${synced} vehicle(s), ${failed} failed`);
  return { synced, failed };
}
