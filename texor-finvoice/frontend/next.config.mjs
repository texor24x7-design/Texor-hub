/**
 * Dev fallbacks apply only in development, for the reason Texor Talk learned
 * the hard way: an inlined fallback is never absent, only wrong, and a
 * production build that forgot a variable would ship localhost links.
 */
const DEV = process.env.NODE_ENV !== 'production';
const origin = (value, devFallback) => (value || (DEV ? devFallback : '')).replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets a test build live beside the dev server's output instead of overwriting it.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  env: {
    NEXT_PUBLIC_API_ORIGIN: origin(process.env.NEXT_PUBLIC_API_ORIGIN, 'http://localhost:4001') || 'http://localhost:4001',
    NEXT_PUBLIC_ACCOUNTS_ORIGIN: origin(process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN, 'http://localhost:3000'),
    NEXT_PUBLIC_FINVOICE_ORIGIN: origin(process.env.NEXT_PUBLIC_FINVOICE_ORIGIN, 'http://localhost:3001'),
    NEXT_PUBLIC_TALK_ORIGIN: origin(process.env.NEXT_PUBLIC_TALK_ORIGIN, 'http://localhost:3002'),
    NEXT_PUBLIC_PAYROLL_ORIGIN: origin(process.env.NEXT_PUBLIC_PAYROLL_ORIGIN, 'http://localhost:3003'),
  },
};

export default nextConfig;
