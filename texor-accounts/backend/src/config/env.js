/**
 * Environment loading and validation.
 *
 * Nothing else in the codebase reads process.env directly — everything imports
 * `env` from here so a missing or malformed variable fails loudly at boot
 * instead of surfacing as a confusing runtime error later.
 */
import { z } from 'zod';

const csv = (value) =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  ISSUER_ORIGIN: z.url(),
  ACCOUNTS_WEB_ORIGIN: z.url(),
  CORS_ORIGINS: z.string().default(''),

  MONGODB_URI: z.string().min(1),

  COOKIE_DOMAIN: z.string().default(''),
  COOKIE_KEYS: z.string().min(1),

  OIDC_JWKS: z.string().default(''),
  SECRET_ENCRYPTION_KEY: z.string().default(''),

  SEED_ADMIN_EMAIL: z.email().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),

  // ── Upstream sign-in providers ───────────────────────────────────────────
  // Each is optional. A provider is offered to users only when both its id and
  // secret are set, so a deployment can enable Google alone without any code
  // change. The *_ISSUER overrides exist for single-tenant Microsoft setups and
  // for pointing a provider at a test double.
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_ISSUER: z.string().default(''),

  MICROSOFT_CLIENT_ID: z.string().default(''),
  MICROSOFT_CLIENT_SECRET: z.string().default(''),
  MICROSOFT_TENANT: z.string().default('common'),
  MICROSOFT_ISSUER: z.string().default(''),

  LINKEDIN_CLIENT_ID: z.string().default(''),
  LINKEDIN_CLIENT_SECRET: z.string().default(''),
  LINKEDIN_ISSUER: z.string().default(''),

  ZOHO_CLIENT_ID: z.string().default(''),
  ZOHO_CLIENT_SECRET: z.string().default(''),
  // Zoho runs separate data centres and an account exists in exactly one of
  // them. The region decides which host issues and validates tokens.
  ZOHO_REGION: z.enum(['com', 'eu', 'in', 'com.au', 'jp', 'com.cn', 'ca']).default('com'),
  ZOHO_ISSUER: z.string().default(''),

  // ── Transactional email ──────────────────────────────────────────────────
  APP_NAME: z.string().default('Texor'),
  MAIL_FROM: z.string().default('Texor <onboarding@resend.dev>'),
  MAIL_REPLY_TO: z.string().default(''),
  RESEND_API_KEY: z.string().default(''),

  // ── Uploads ──────────────────────────────────────────────────────────────
  CLOUDINARY_CLOUD_NAME: z.string().default(''),
  CLOUDINARY_API_KEY: z.string().default(''),
  CLOUDINARY_API_SECRET: z.string().default(''),
  CLOUDINARY_FOLDER: z.string().default('texor/avatars'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
}

const raw = parsed.data;
const isProduction = raw.NODE_ENV === 'production';

let jwks = null;
if (raw.OIDC_JWKS) {
  try {
    jwks = JSON.parse(raw.OIDC_JWKS);
  } catch {
    throw new Error('OIDC_JWKS is not valid JSON. Regenerate it with `npm run keys:generate`.');
  }
  if (!Array.isArray(jwks) || jwks.length === 0) {
    throw new Error('OIDC_JWKS must be a non-empty JSON array of private JWKs.');
  }
}

if (isProduction && !jwks) {
  throw new Error('OIDC_JWKS is required in production. Generate it with `npm run keys:generate`.');
}

if (isProduction && !raw.SECRET_ENCRYPTION_KEY) {
  throw new Error('SECRET_ENCRYPTION_KEY is required in production. Generate it with `npm run keys:generate`.');
}

/**
 * Validate the encryption key at boot rather than at first use.
 *
 * This key only comes into play when a product's client secret is encrypted or
 * decrypted, so a missing or malformed one stays invisible until much later —
 * and then surfaces as `invalid_client` on an authorization request, which
 * points nowhere near the actual cause. Failing (or shouting) here instead.
 */
if (raw.SECRET_ENCRYPTION_KEY) {
  let decoded;
  try {
    decoded = Buffer.from(raw.SECRET_ENCRYPTION_KEY, 'base64');
  } catch {
    decoded = null;
  }
  if (!decoded || decoded.length !== 32) {
    throw new Error(
      `SECRET_ENCRYPTION_KEY must be exactly 32 bytes encoded as base64 (got ${decoded ? decoded.length : 0}). `
      + 'Regenerate it with `npm run keys:generate`.',
    );
  }
} else {
  console.warn(
    '[texor-accounts] SECRET_ENCRYPTION_KEY is empty. Product client secrets cannot be encrypted or '
    + 'decrypted, so registering a product will fail and every authorization request will answer '
    + 'invalid_client. Run `npm run keys:generate` and set it in .env.',
  );
}

/**
 * Email is not optional in production: without it nobody can verify an address
 * or recover a password, and both failures are silent until a user is stuck.
 */
if (isProduction && !raw.RESEND_API_KEY) {
  throw new Error(
    'RESEND_API_KEY is required in production. Email verification and password reset cannot '
    + 'work without it. Set it, or explicitly run with NODE_ENV=development.',
  );
}

export const env = {
  ...raw,
  // Feature switches, so callers ask "is this configured" rather than
  // re-deriving it from three separate variables.
  mailEnabled: Boolean(raw.RESEND_API_KEY),
  uploadsEnabled: Boolean(
    raw.CLOUDINARY_CLOUD_NAME && raw.CLOUDINARY_API_KEY && raw.CLOUDINARY_API_SECRET,
  ),
  isProduction,
  /** Full OIDC issuer identifier. Its path segment is also the provider mount path. */
  issuer: `${raw.ISSUER_ORIGIN.replace(/\/$/, '')}/oidc`,
  accountsWebOrigin: raw.ACCOUNTS_WEB_ORIGIN.replace(/\/$/, ''),
  corsOrigins: csv(raw.CORS_ORIGINS),
  cookieKeys: csv(raw.COOKIE_KEYS),
  cookieDomain: raw.COOKIE_DOMAIN || undefined,
  jwks,
};

if (env.cookieKeys.length === 0) {
  throw new Error('COOKIE_KEYS must contain at least one secret.');
}

export default env;
