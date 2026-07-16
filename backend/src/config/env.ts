import 'dotenv/config';
import { z } from 'zod';

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
  WALLESTER_MOCK: z.coerce.boolean().default(true),
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
  ADMIN_EMAIL: z.string().default('admin@motoriq.co.uk'),
  ADMIN_PASSWORD: z.string().default('admin12345'),

  // Email (Resend) + email verification.
  // Without RESEND_API_KEY, emails are logged instead of sent (mock).
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('MOTORIQ <onboarding@resend.dev>'),
  // Public base URL of THIS API (used to build the verification link).
  APP_PUBLIC_URL: z.string().default('http://localhost:4000'),
  // If true, unverified users cannot log in. Default false (won't lock anyone out).
  REQUIRE_EMAIL_VERIFICATION: z.coerce.boolean().default(false),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
