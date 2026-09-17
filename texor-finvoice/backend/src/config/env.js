/**
 * Environment loading and validation for Finvoice.
 */
import { z } from 'zod';

const csv = (value) => (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4001),

  API_ORIGIN: z.url().optional(),
  APP_ORIGIN: z.url(),
  CORS_ORIGINS: z.string().default(''),

  MONGODB_URI: z.string().min(1),

  TEXOR_ISSUER: z.url(),
  TEXOR_CLIENT_ID: z.string().min(1),
  TEXOR_CLIENT_SECRET: z.string({ error: 'Run `npm run seed` in texor-accounts to get a client secret.' }).min(1),
  TEXOR_REDIRECT_URI: z.url(),
  TEXOR_SCOPE: z.string().default('openid profile email offline_access'),
  TEXOR_RESOURCE: z.string().optional(),

  COOKIE_SECRET: z.string().min(8),
  COOKIE_DOMAIN: z.string().default(''),

  // Where public document links (/d/:token) point. Defaults to APP_ORIGIN.
  PUBLIC_ORIGIN: z.url().optional(),
  UPLOAD_MAX_MB: z.coerce.number().positive().max(50).default(5),

  // AES-256-GCM key for integration secrets (Gmail refresh tokens, WhatsApp
  // tokens, SMTP passwords). 32 bytes, base64. Required in production; a dev
  // key is derived from COOKIE_SECRET otherwise so a fresh clone still boots.
  ENCRYPTION_KEY: z.string().optional(),

  // Optional. Gmail sending stays hidden while these are unset.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.url().optional(),

  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),

  // Tests only: build every email and WhatsApp payload but send nothing.
  DELIVERY_DRY_RUN: z.enum(['0', '1']).default('0'),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
});

// `KEY=` in an env file arrives as an empty string; treat it as unset so optional
// URLs and defaults behave the way the example file reads.
const parsed = schema.safeParse(
  Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== '')),
);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
}

const raw = parsed.data;

if (raw.NODE_ENV === 'production' && raw.DELIVERY_DRY_RUN === '1') {
  throw new Error('DELIVERY_DRY_RUN must not be set in production — nothing would ever be sent.');
}

if (raw.NODE_ENV === 'production' && !raw.ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY is required in production. Generate one with: openssl rand -base64 32');
}

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  appOrigin: raw.APP_ORIGIN.replace(/\/$/, ''),
  corsOrigins: csv(raw.CORS_ORIGINS),
  cookieDomain: raw.COOKIE_DOMAIN || undefined,
  publicOrigin: (raw.PUBLIC_ORIGIN ?? raw.APP_ORIGIN).replace(/\/$/, ''),
  // Documents are rendered with absolute URLs for their logo, signature and fonts.
  // The Texor callback is registered on this API, so its origin is a sound default.
  apiOrigin: raw.API_ORIGIN ? raw.API_ORIGIN.replace(/\/$/, '') : new URL(raw.TEXOR_REDIRECT_URI).origin,
  uploadMaxBytes: raw.UPLOAD_MAX_MB * 1024 * 1024,
  gmailEnabled: Boolean(raw.GOOGLE_CLIENT_ID && raw.GOOGLE_CLIENT_SECRET && raw.GOOGLE_REDIRECT_URI),
  dryRun: raw.DELIVERY_DRY_RUN === '1',
};

export default env;
