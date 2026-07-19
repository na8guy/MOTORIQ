import 'dotenv/config';
import { z } from 'zod';

/**
 * Parse a boolean from an env var. IMPORTANT: do NOT use z.coerce.boolean() —
 * it does Boolean(value), so the string "false" (non-empty) becomes `true`.
 * This treats only "true"/"1"/"yes"/"on" (case-insensitive) as true.
 */
const envBool = (def: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return def;
    if (typeof v === 'boolean') return v;
    return ['true', '1', 'yes', 'on'].includes(String(v).trim().toLowerCase());
  }, z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('*'),

  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // Wallester
  WALLESTER_MOCK: envBool(true),
  WALLESTER_BASE_URL: z.string().default('https://api.wallester.com'),
  WALLESTER_API_VERSION: z.string().default('6.0'),
  WALLESTER_AUDIENCE_ID: z.string().optional(),
  WALLESTER_API_KEY: z.string().optional(),
  WALLESTER_PRIVATE_KEY: z.string().optional(),
  WALLESTER_PROGRAM_ID: z.string().optional(),
  WALLESTER_CARD_PRODUCT_ID: z.string().optional(),
  WALLESTER_DEFAULT_CURRENCY: z.string().default('GBP'),

  // Fuel Finder
  // mock      → bundled sample stations (no network)
  // single    → the official gov.uk Fuel Finder REST endpoint
  // aggregate → pull the UK scheme's public per-retailer JSON feeds (no auth)
  FUEL_FINDER_MODE: z.enum(['mock', 'single', 'aggregate']).default('mock'),
  FUEL_FINDER_BASE_URL: z.string().default('https://api.fuel-finder.service.gov.uk'),
  // Auth for `single` mode. The official Fuel Finder API uses OAuth 2.0
  // client-credentials: set CLIENT_ID + CLIENT_SECRET + TOKEN_URL and the
  // client fetches a bearer token automatically. FUEL_FINDER_API_KEY is only a
  // fallback for a provider that issues a static bearer key instead.
  FUEL_FINDER_CLIENT_ID: z.string().optional(),
  FUEL_FINDER_CLIENT_SECRET: z.string().optional(),
  FUEL_FINDER_TOKEN_URL: z.string().optional(),
  FUEL_FINDER_SCOPE: z.string().optional(),
  // 'post' (client_id/secret in the form body, default) or 'basic' (HTTP Basic).
  FUEL_FINDER_AUTH_STYLE: z.enum(['post', 'basic']).default('post'),
  FUEL_FINDER_API_KEY: z.string().optional(),
  // Comma-separated retailer feed URLs (used in aggregate mode). Defaults to
  // the well-known UK CMA/Fuel Finder open-data feeds.
  FUEL_RETAILER_FEEDS: z.string().optional(),
  // Cache TTL for fetched feeds (seconds).
  FUEL_FEED_TTL_SECONDS: z.coerce.number().default(900),
  // Default tank size used when computing "save £X on a full tank".
  DEFAULT_TANK_LITRES: z.coerce.number().default(45),

  // ── DVLA / DVSA vehicle data (auto MOT + tax reminders) ──
  // Two separate government APIs, because neither alone has both dates:
  //
  //  1. DVLA Vehicle Enquiry Service (VES) → taxStatus, taxDueDate, make,
  //     colour, fuelType, yearOfManufacture, motStatus. Simple x-api-key.
  //     Register: https://developer-portal.driver-vehicle-licensing.api.gov.uk
  //     NOTE: new VES registrations were CLOSED as of 2026-07 ("system
  //     upgrades") — leave unset and the client returns mock data.
  //
  //  2. DVSA MOT History API → motExpiryDate + mileage readings. OAuth 2.0
  //     client-credentials (Azure AD) *plus* an x-api-key.
  //     Register: https://documentation.history.mot.api.gov.uk
  //
  // With neither configured, DVLA_MOCK returns believable sample data so the
  // reminder flow is exercisable end-to-end.
  DVLA_MOCK: envBool(true),
  DVLA_VES_API_KEY: z.string().optional(),
  DVLA_VES_BASE_URL: z
    .string()
    .default('https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles'),
  MOT_HISTORY_BASE_URL: z.string().default('https://history.mot.api.gov.uk/v1/trade/vehicles'),
  MOT_HISTORY_API_KEY: z.string().optional(),
  MOT_HISTORY_CLIENT_ID: z.string().optional(),
  MOT_HISTORY_CLIENT_SECRET: z.string().optional(),
  // DVSA issues per-tenant Azure AD token URLs. This is SaveOnDrive's tenant —
  // it is not a secret (the client id and secret are), so defaulting it here
  // means one less thing to get wrong in the Render dashboard.
  MOT_HISTORY_TOKEN_URL: z
    .string()
    .default(
      'https://login.microsoftonline.com/a455b827-244f-4c97-b5b4-ce5d13b4d00c/oauth2/v2.0/token',
    ),
  MOT_HISTORY_SCOPE: z.string().default('https://tapi.dvsa.gov.uk/.default'),

  // ── EV charging (Open Charge Map) ──
  // Free API key: openchargemap.org → My Profile → My Apps → Register
  // Application. Without a key the API returns 403, so we fall back to samples.
  // NOTE: OCM's cost field (UsageCost) is FREE TEXT ("£0.45/kWh", "Free",
  // "Parking fees apply"), not a number — so price is only known for some
  // sites. See openchargemap.client.ts.
  OCM_API_KEY: z.string().optional(),
  OCM_BASE_URL: z.string().default('https://api.openchargemap.io/v3/poi'),

  // ── Drive-time routing ──
  // OSRM's public demo server is free and needs no key, but its usage policy
  // forbids heavy production traffic — host your own or swap in a paid router
  // before real volume. Falls back to a distance estimate when unavailable.
  ROUTING_ENABLED: envBool(true),
  OSRM_BASE_URL: z.string().default('https://router.project-osrm.org'),

  // ── Legal document versions ──
  // Bump when the terms materially change: members whose accepted version is
  // older must accept again (UK GDPR requires demonstrable, current consent).
  TERMS_VERSION: z.string().default('2026-07-16'),
  PRIVACY_VERSION: z.string().default('2026-07-16'),
  TERMS_URL: z.string().default('https://saveondrive.co.uk/terms'),
  PRIVACY_URL: z.string().default('https://saveondrive.co.uk/privacy'),

  // ── Stripe (membership billing) ──
  // Without STRIPE_SECRET_KEY the client runs in mock mode: checkout returns a
  // fake URL and nothing is charged, so the upgrade flow stays testable before
  // the account exists. /admin/diagnostics reports which mode is live.
  //
  // STRIPE_WEBHOOK_SECRET is not optional in spirit: without it the webhook
  // endpoint refuses every event, because an unverified webhook would let
  // anyone POST "subscription active" and grant themselves Pro for free.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** Where Stripe sends the member back to after checkout. */
  STRIPE_SUCCESS_URL: z.string().default('saveondrive://billing/success'),
  STRIPE_CANCEL_URL: z.string().default('saveondrive://billing/cancelled'),

  // AI savings insights (Claude). Optional — falls back to a rule-based
  // narrative when no key is set.
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_INSIGHTS_MODEL: z.string().default('claude-opus-4-8'),

  // Push notifications (Firebase Cloud Messaging). mock logs instead of sending.
  PUSH_PROVIDER: z.enum(['mock', 'fcm']).default('mock'),
  FCM_PROJECT_ID: z.string().optional(),
  FCM_CLIENT_EMAIL: z.string().optional(),
  FCM_PRIVATE_KEY: z.string().optional(), // PEM, \n-escaped

  // Admin seeding (used by `npm run seed`).
  ADMIN_EMAIL: z.string().default('admin@saveondrive.co.uk'),
  ADMIN_PASSWORD: z.string().default('admin12345'),

  // Email (Resend) + email verification.
  // Without RESEND_API_KEY, emails are logged instead of sent (mock).
  RESEND_API_KEY: z.string().optional(),
  // Must be an address on a domain you've verified in Resend. Using the shared
  // onboarding@resend.dev sandbox only allows sending to your own Resend
  // account email — a verified domain can send to any recipient.
  EMAIL_FROM: z.string().default('SaveOnDrive <noreply@wanadryve.xyz>'),
  // Public base URL of THIS API (used to build the verification link).
  APP_PUBLIC_URL: z.string().default('http://localhost:4000'),
  // If true, unverified users cannot log in. Default false (won't lock anyone out).
  REQUIRE_EMAIL_VERIFICATION: envBool(false),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
