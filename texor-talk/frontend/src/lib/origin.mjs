/**
 * Where this deployment actually lives.
 *
 * A link card names its image with an absolute URL, so getting this wrong is
 * invisible: the page renders, the tags are all present, and every chat client
 * quietly fetches nothing. Production was telling WhatsApp to load the picture
 * from `http://localhost:3002`.
 *
 * The trap is that `next.config.mjs` inlines dev fallbacks into `process.env`
 * at build time, so these variables are never `undefined` and no `??` guard
 * downstream can fire. A value being *set* is not the same as it being *right*,
 * so this asks what the value says rather than whether it exists.
 */

const LOCAL = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i;

const trim = (value) => String(value ?? '').trim().replace(/\/+$/, '');

/** `talk.texor.app` and `https://talk.texor.app/` should mean the same thing. */
export function normalise(value) {
  const text = trim(value);
  if (!text) return '';
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

/**
 * True for anything that only resolves on the machine that built it — the one
 * class of value that is worse than missing, because it looks configured.
 */
export function isLocalOrigin(value) {
  const text = normalise(value);
  if (!text) return true;
  try {
    return LOCAL.test(new URL(text).host);
  } catch {
    return true;
  }
}

/**
 * `configured` wins whenever it names a real host. Otherwise the platform is
 * asked: Vercel sets these on every deployment, so a forgotten environment
 * variable degrades to the right answer instead of to a dead link.
 */
export function resolveOrigin({
  configured = process.env.NEXT_PUBLIC_TALK_ORIGIN,
  productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL,
  deploymentUrl = process.env.VERCEL_URL,
  fallback = 'http://localhost:3002',
} = {}) {
  if (!isLocalOrigin(configured)) return normalise(configured);

  // The project's own domain before this particular deployment's URL: previews
  // should still advertise the card that people will actually see.
  if (trim(productionUrl)) return normalise(productionUrl);
  if (trim(deploymentUrl)) return normalise(deploymentUrl);

  return normalise(configured) || normalise(fallback);
}

export default { resolveOrigin, isLocalOrigin, normalise };
