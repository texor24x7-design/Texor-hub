/**
 * Checks the outbound services this deployment depends on.
 *
 *   npm run check:integrations
 *
 * Email and image hosting fail in ways that are invisible until a user is
 * already stuck — an unverified address with no way to resend, or an upload
 * that 401s after the file has been chosen. This confirms the credentials work
 * before anyone relies on them.
 */
import env from '../src/config/env.js';

const ok = (label, detail = '') => console.log(`  ok    ${label}${detail ? `  ${detail}` : ''}`);
const bad = (label, detail = '') => console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ''}`);
const off = (label, detail = '') => console.log(`  --    ${label}${detail ? `  ${detail}` : ''}`);

console.log(`\nOutbound integrations  (${env.NODE_ENV})\n`);

let failures = 0;

// ── Resend ───────────────────────────────────────────────────────────────────
console.log('  Email (Resend)');
if (!env.mailEnabled) {
  off('not configured', 'verification links are printed to the server log instead of sent');
  if (env.isProduction) {
    failures += 1;
    bad('and this is production', 'RESEND_API_KEY is required');
  }
} else {
  try {
    // Listing domains is the cheapest authenticated call that proves the key.
    const response = await fetch('https://api.resend.com/domains', {
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 401 || response.status === 403) {
      failures += 1;
      bad('API key rejected', 'check RESEND_API_KEY');
    } else if (!response.ok) {
      failures += 1;
      bad('unexpected response', `HTTP ${response.status}`);
    } else {
      const payload = await response.json().catch(() => ({}));
      const domains = payload.data ?? [];
      ok('API key accepted');
      ok('sending as', env.MAIL_FROM);

      const address = env.MAIL_FROM.match(/<([^>]+)>/)?.[1] ?? env.MAIL_FROM;
      const domain = address.split('@')[1];

      if (domain === 'resend.dev') {
        off('using Resend’s sandbox sender', 'delivers only to your own address — verify a domain before launch');
      } else {
        const verified = domains.find((entry) => entry.name === domain && entry.status === 'verified');
        if (verified) ok(`domain ${domain} is verified`);
        else {
          failures += 1;
          bad(`domain ${domain} is not verified on this Resend account`, 'mail will be rejected');
        }
      }
    }
  } catch (error) {
    failures += 1;
    bad('could not reach Resend', error.message);
  }
}

// ── Cloudinary ───────────────────────────────────────────────────────────────
console.log('\n  Uploads (Cloudinary)');
if (!env.uploadsEnabled) {
  off('not configured', 'the profile picture falls back to a URL field');
} else {
  try {
    const credentials = Buffer
      .from(`${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`)
      .toString('base64');

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/ping`,
      { headers: { authorization: `Basic ${credentials}` }, signal: AbortSignal.timeout(15_000) },
    );

    if (response.ok) {
      ok('credentials accepted', `cloud "${env.CLOUDINARY_CLOUD_NAME}"`);
      ok('uploading into', `${env.CLOUDINARY_FOLDER}/<account id>/`);
    } else if (response.status === 401) {
      failures += 1;
      bad('credentials rejected', 'check CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET');
    } else if (response.status === 404) {
      failures += 1;
      bad('cloud name not found', `check CLOUDINARY_CLOUD_NAME ("${env.CLOUDINARY_CLOUD_NAME}")`);
    } else {
      failures += 1;
      bad('unexpected response', `HTTP ${response.status}`);
    }
  } catch (error) {
    failures += 1;
    bad('could not reach Cloudinary', error.message);
  }
}

console.log('');
process.exit(failures ? 1 : 0);
