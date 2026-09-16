import { resolveOrigin, normalise } from './src/lib/origin.mjs';

/**
 * Dev fallbacks apply **only** in development.
 *
 * They used to apply everywhere. Because this block inlines its values into
 * `process.env` at build time, a deployment that forgot one of these variables
 * did not get `undefined` — it got the literal string `http://localhost:3000`,
 * which defeats every `?? fallback` guard written downstream and ships links
 * that work on the machine of the person who wrote them and nowhere else.
 *
 * That is how a shared meeting link came to advertise its preview image at
 * `http://localhost:3002/opengraph-image`, which no crawler can fetch.
 *
 * In production an unset origin is an empty string: `lib/ecosystem.js` drops a
 * sibling product that has no origin, so a missing link is a thing somebody
 * notices and fixes, rather than a mysterious failure reported months later.
 */
const DEV = process.env.NODE_ENV !== 'production';

const origin = (value, devFallback) => normalise(value) || (DEV ? devFallback : '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // The backend is required in every environment rather than optional in
    // some, so it keeps its fallback: there is no "not offered" state for it
    // to degrade to, and an empty value would only move the failure.
    NEXT_PUBLIC_API_ORIGIN: normalise(process.env.NEXT_PUBLIC_API_ORIGIN) || 'http://localhost:4002',

    // Where this product hands people back to their account, and across to its
    // siblings. Defaults match the dev ports in the ecosystem README.
    NEXT_PUBLIC_ACCOUNTS_ORIGIN: origin(process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN, 'http://localhost:3000'),
    NEXT_PUBLIC_FINVOICE_ORIGIN: origin(process.env.NEXT_PUBLIC_FINVOICE_ORIGIN, 'http://localhost:3001'),
    NEXT_PUBLIC_PAYROLL_ORIGIN: origin(process.env.NEXT_PUBLIC_PAYROLL_ORIGIN, 'http://localhost:3003'),

    // This one is asked of the platform rather than left empty: the host's own
    // address is the one value a deployment can always work out for itself, and
    // the preview card is unusable without it.
    NEXT_PUBLIC_TALK_ORIGIN: resolveOrigin({
      configured: process.env.NEXT_PUBLIC_TALK_ORIGIN,
      fallback: DEV ? 'http://localhost:3002' : '',
    }),
  },
};

export default nextConfig;
