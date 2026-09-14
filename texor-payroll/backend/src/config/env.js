/**
 * Environment loading and validation for Texor Payroll.
 */
import { z } from 'zod';

const csv = (value) => (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4003),

  APP_ORIGIN: z.url(),
  CORS_ORIGINS: z.string().default(''),

  MONGODB_URI: z.string().min(1),

  TEXOR_ISSUER: z.url(),
  TEXOR_CLIENT_ID: z.string().min(1),
  TEXOR_CLIENT_SECRET: z.string().min(1, 'Run `npm run seed` in texor-accounts to get a client secret.'),
  TEXOR_REDIRECT_URI: z.url(),
  TEXOR_SCOPE: z.string().default('openid profile email offline_access'),
  TEXOR_RESOURCE: z.string().optional(),

  COOKIE_SECRET: z.string().min(8),
  COOKIE_DOMAIN: z.string().default(''),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  appOrigin: raw.APP_ORIGIN.replace(/\/$/, ''),
  corsOrigins: csv(raw.CORS_ORIGINS),
  cookieDomain: raw.COOKIE_DOMAIN || undefined,
};

export default env;
