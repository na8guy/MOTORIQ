import { request } from 'undici';
import { env } from '../../config/env.js';

/**
 * UK vehicle data lookup — powers automatic MOT and road-tax reminders so a
 * member only types their registration and we fill in the rest.
 *
 * This deliberately talks to TWO government APIs, because neither has both
 * dates we need:
 *
 *   DVLA Vehicle Enquiry Service (VES)  → taxDueDate, taxStatus, motStatus,
 *                                         make, colour, fuelType, year
 *   DVSA MOT History API                → motExpiryDate, mileage readings
 *
 * VES publishes only an MOT *status* ("Valid"/"Not valid"), never an expiry
 * date — verified against the published VES field list on 2026-07-16. So MOT
 * expiry, which is the date members actually need reminding about, must come
 * from the MOT History API.
 *
 * What we deliberately do NOT pretend to fetch:
 *   • Insurance renewal — held in the Motor Insurance Database, restricted to
 *     insurers and police. No public API exists. Member-entered.
 *   • Service due — a per-manufacturer schedule, not published data. We can
 *     estimate from MOT mileage readings, but it is member-entered.
 *
 * Both APIs degrade to mock data when unconfigured (DVLA_MOCK), so the whole
 * reminder flow is exercisable without credentials.
 */

export interface VehicleLookup {
  registration: string;
  make: string | null;
  model: string | null;
  colour: string | null;
  fuelType: string | null;
  year: number | null;
  taxStatus: string | null;
  taxDueDate: string | null; // ISO date
  motStatus: string | null;
  motExpiryDate: string | null; // ISO date
  mileage: number | null;
  /** 'live' when at least one government API answered; 'mock' otherwise. */
  source: 'live' | 'mock';
  /** Non-fatal explanation when a lookup could not be completed. */
  error?: string;
}

/** VES response fields we use (its full schema is much larger). */
interface VesResponse {
  registrationNumber?: string;
  make?: string;
  colour?: string;
  fuelType?: string;
  yearOfManufacture?: number;
  taxStatus?: string;
  taxDueDate?: string;
  motStatus?: string;
}

interface MotTest {
  completedDate?: string;
  testResult?: string;
  expiryDate?: string;
  odometerValue?: string;
  odometerUnit?: string;
}
interface MotResponse {
  make?: string;
  model?: string;
  primaryColour?: string;
  fuelType?: string;
  manufactureDate?: string;
  motTests?: MotTest[];
}

/** VRNs must be alphanumeric with no spaces — DVLA rejects anything else. */
export function normaliseVrn(reg: string): string {
  return reg.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

class DvlaClient {
  private token: { value: string; expiresAt: number } | null = null;

  /** Look a vehicle up across both APIs, merging what each one knows. */
  async lookup(registration: string): Promise<VehicleLookup> {
    const vrn = normaliseVrn(registration);
    if (!vrn) return { ...emptyLookup(vrn), source: 'mock', error: 'Invalid registration' };

    if (env.DVLA_MOCK || (!env.DVLA_VES_API_KEY && !env.MOT_HISTORY_API_KEY)) {
      return mockLookup(vrn);
    }

    // Independent APIs — one being down must not lose the other's data.
    const [ves, mot] = await Promise.all([this.fetchVes(vrn), this.fetchMot(vrn)]);

    if (!ves.data && !mot.data) {
      return { ...emptyLookup(vrn), source: 'mock', error: ves.error ?? mot.error ?? 'Lookup failed' };
    }

    const latestTest = (mot.data?.motTests ?? [])
      .filter((t) => t.expiryDate)
      .sort((a, b) => (b.expiryDate! > a.expiryDate! ? 1 : -1))[0];

    const odo = latestTest?.odometerValue ? Number(latestTest.odometerValue) : null;

    return {
      registration: vrn,
      make: ves.data?.make ?? mot.data?.make ?? null,
      model: mot.data?.model ?? null, // VES does not return a model
      colour: ves.data?.colour ?? mot.data?.primaryColour ?? null,
      fuelType: ves.data?.fuelType ?? mot.data?.fuelType ?? null,
      year: ves.data?.yearOfManufacture ?? yearFrom(mot.data?.manufactureDate) ?? null,
      taxStatus: ves.data?.taxStatus ?? null,
      taxDueDate: isoDate(ves.data?.taxDueDate),
      motStatus: ves.data?.motStatus ?? (latestTest?.testResult ?? null),
      motExpiryDate: isoDate(latestTest?.expiryDate),
      mileage: Number.isFinite(odo) ? odo : null,
      source: 'live',
      ...(ves.error || mot.error ? { error: [ves.error, mot.error].filter(Boolean).join('; ') } : {}),
    };
  }

  // ── DVLA Vehicle Enquiry Service ──
  private async fetchVes(vrn: string): Promise<{ data: VesResponse | null; error?: string }> {
    const key = env.DVLA_VES_API_KEY;
    if (!key) return { data: null, error: 'VES not configured' };
    try {
      const res = await request(env.DVLA_VES_BASE_URL, {
        method: 'POST',
        headers: { 'x-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ registrationNumber: vrn }),
      });
      if (res.statusCode === 404) {
        res.body.dump();
        return { data: null, error: 'Registration not found at DVLA' };
      }
      if (res.statusCode >= 400) {
        const body = await res.body.text();
        console.warn(`[dvla] VES ${res.statusCode} for ${vrn}: ${body.slice(0, 200)}`);
        return { data: null, error: `DVLA responded ${res.statusCode}` };
      }
      return { data: (await res.body.json()) as VesResponse };
    } catch (err) {
      console.warn(`[dvla] VES error for ${vrn}: ${msg(err)}`);
      return { data: null, error: 'DVLA unreachable' };
    }
  }

  // ── DVSA MOT History ──
  private async fetchMot(vrn: string): Promise<{ data: MotResponse | null; error?: string }> {
    const key = env.MOT_HISTORY_API_KEY;
    if (!key) return { data: null, error: 'MOT History not configured' };
    try {
      const bearer = await this.motToken();
      if (!bearer) return { data: null, error: 'MOT History auth not configured' };
      const res = await request(`${env.MOT_HISTORY_BASE_URL}/registration/${encodeURIComponent(vrn)}`, {
        method: 'GET',
        headers: { 'x-api-key': key, authorization: `Bearer ${bearer}`, accept: 'application/json' },
      });
      if (res.statusCode === 404) {
        res.body.dump();
        return { data: null, error: 'No MOT history for this registration' };
      }
      if (res.statusCode >= 400) {
        const body = await res.body.text();
        console.warn(`[dvla] MOT ${res.statusCode} for ${vrn}: ${body.slice(0, 200)}`);
        return { data: null, error: `MOT History responded ${res.statusCode}` };
      }
      return { data: (await res.body.json()) as MotResponse };
    } catch (err) {
      console.warn(`[dvla] MOT error for ${vrn}: ${msg(err)}`);
      return { data: null, error: 'MOT History unreachable' };
    }
  }

  /** OAuth 2.0 client-credentials for the MOT History API, cached until expiry. */
  private async motToken(): Promise<string | null> {
    const clientId = env.MOT_HISTORY_CLIENT_ID;
    const clientSecret = env.MOT_HISTORY_CLIENT_SECRET;
    const tokenUrl = env.MOT_HISTORY_TOKEN_URL;
    if (!clientId || !clientSecret || !tokenUrl) return null;

    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;

    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: env.MOT_HISTORY_SCOPE,
    });
    const res = await request(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (res.statusCode >= 400) {
      console.warn(`[dvla] MOT token endpoint responded ${res.statusCode}`);
      res.body.dump();
      return null;
    }
    const json = (await res.body.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    // Refresh a minute early to avoid racing expiry.
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000,
    };
    return this.token.value;
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function yearFrom(date?: string): number | null {
  if (!date) return null;
  const y = new Date(date).getFullYear();
  return Number.isFinite(y) ? y : null;
}

/** Normalise a date to ISO yyyy-mm-dd, tolerating DVLA's formats. */
function isoDate(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function emptyLookup(vrn: string): VehicleLookup {
  return {
    registration: vrn,
    make: null,
    model: null,
    colour: null,
    fuelType: null,
    year: null,
    taxStatus: null,
    taxDueDate: null,
    motStatus: null,
    motExpiryDate: null,
    mileage: null,
    source: 'mock',
  };
}

/**
 * Deterministic sample data so a given VRN always looks the same, and the MOT
 * and tax dates land in the future — otherwise every mock vehicle would show
 * as overdue and the reminder flow couldn't be tested.
 */
function mockLookup(vrn: string): VehicleLookup {
  const seed = [...vrn].reduce((a, c) => a + c.charCodeAt(0), 0);
  const makes = ['Ford', 'Vauxhall', 'Volkswagen', 'BMW', 'Toyota', 'Nissan'];
  const models = ['Focus', 'Corsa', 'Golf', '3 Series', 'Yaris', 'Qashqai'];
  const colours = ['Blue', 'Silver', 'Black', 'White', 'Red'];
  const day = 24 * 60 * 60 * 1000;
  const at = (days: number) => new Date(Date.now() + days * day).toISOString().slice(0, 10);

  return {
    registration: vrn,
    make: makes[seed % makes.length]!,
    model: models[seed % models.length]!,
    colour: colours[seed % colours.length]!,
    fuelType: seed % 4 === 0 ? 'ELECTRICITY' : seed % 3 === 0 ? 'DIESEL' : 'PETROL',
    year: 2014 + (seed % 11),
    taxStatus: 'Taxed',
    taxDueDate: at(20 + (seed % 200)),
    motStatus: 'Valid',
    motExpiryDate: at(10 + (seed % 250)),
    mileage: 20_000 + (seed % 90_000),
    source: 'mock',
  };
}

export const dvla = new DvlaClient();
