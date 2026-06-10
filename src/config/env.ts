import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // pino level; defaults to info in production, debug otherwise (see logger.ts).
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('30d'),
  DISCOGS_CONSUMER_KEY: z.string().min(1, 'DISCOGS_CONSUMER_KEY is required'),
  DISCOGS_CONSUMER_SECRET: z.string().min(1, 'DISCOGS_CONSUMER_SECRET is required'),
  DISCOGS_CALLBACK_URL: z.string().url('DISCOGS_CALLBACK_URL must be a valid URL'),
  CLIENT_ORIGIN: z.string().url('CLIENT_ORIGIN must be a valid URL'),
  // Deep link the native (iOS) OAuth flow redirects back to after callback. The
  // JWT pair is appended as a URL fragment (#access=…&refresh=…). Web is
  // unaffected — it keeps redirecting to CLIENT_ORIGIN with httpOnly cookies.
  IOS_CALLBACK_URL: z.string().default('provinyl://auth/callback'),
  // 32-byte key (64 hex chars) for AES-256-GCM encryption of Discogs tokens at
  // rest. Generate with: openssl rand -hex 32
  TOKEN_ENC_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TOKEN_ENC_KEY must be 64 hex characters (32 bytes)'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
