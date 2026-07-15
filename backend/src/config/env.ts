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
  FUEL_FINDER_MOCK: z.coerce.boolean().default(true),
  FUEL_FINDER_BASE_URL: z.string().default('https://api.fuel-finder.service.gov.uk'),
  FUEL_FINDER_API_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
