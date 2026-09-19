/**
 * Environment loading and validation for Texor Notes.
 */
import { z } from 'zod';

const csv = (value) => (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4004),

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

  /**
   * Who may mark an API key trusted.
   *
   * A trusted key can say which person a note belongs to, which is how Texor
   * Talk files a meeting note in the account of whoever wrote it rather than in
   * the account that happens to hold the key. That is an impersonation
   * capability, so it is deployment configuration and not something anybody can
   * grant themselves from inside the product. Empty — the default — means no
   * key is ever trusted.
   */
  TRUSTED_KEY_EMAILS: z.string().default(''),
});

/**
 * `KEY=` in an env file arrives as an empty string, which a `.default()` never
 * sees and `z.url()` rejects with a message about the wrong thing. Treat an
 * empty value as an absent one.
 */
const present = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== ''),
);

const parsed = schema.safeParse(present);

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
  trustedKeyEmails: csv(raw.TRUSTED_KEY_EMAILS).map((email) => email.toLowerCase()),
};

export default env;
