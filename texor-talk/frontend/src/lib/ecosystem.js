/**
 * Where the rest of Texor lives.
 *
 * One account carries somebody across every product, so every product should be
 * able to hand them back to their account page and across to its siblings. The
 * origins are configuration rather than constants: they differ between a laptop
 * running four dev servers and a deployment on four subdomains, and hard-coding
 * either one would be wrong somewhere.
 *
 * A product with no origin configured is simply not offered, so a deployment
 * that only runs two of them shows two.
 */
/**
 * The dev fallbacks apply **only** in development.
 *
 * They used to apply everywhere, so a deployment that forgot to set one of
 * these shipped a link to `http://localhost:3000` — which works on the machine
 * of the person who wrote it and nowhere else. A guest clicking "Manage your
 * Texor Account" in production was sent to their own laptop.
 *
 * In production an unset origin means the product is simply not offered, which
 * the filter at the bottom of this file already handles. A missing link is a
 * thing somebody notices and fixes; a link to localhost is one they report as a
 * mysterious failure months later.
 */
const DEV = process.env.NODE_ENV !== 'production';

const origin = (value, devFallback) =>
  (value ?? (DEV ? devFallback : '') ?? '').replace(/\/$/, '');

export const ACCOUNTS_ORIGIN = origin(
  process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN,
  'http://localhost:3000',
);

export const PRODUCTS = [
  {
    id: 'account',
    name: 'Texor Account',
    blurb: 'Profile, security and sign-in',
    href: ACCOUNTS_ORIGIN,
    initial: 'T',
    tint: '#6d28d9',
  },
  {
    id: 'talk',
    name: 'Texor Talk',
    blurb: 'Meetings and messaging',
    href: origin(process.env.NEXT_PUBLIC_TALK_ORIGIN, 'http://localhost:3002'),
    initial: 'T',
    tint: '#2563eb',
    current: true,
  },
  {
    id: 'finvoice',
    name: 'Finvoice',
    blurb: 'Invoicing',
    href: origin(process.env.NEXT_PUBLIC_FINVOICE_ORIGIN, 'http://localhost:3001'),
    initial: 'F',
    tint: '#0f766e',
  },
  {
    id: 'payroll',
    name: 'Payroll',
    blurb: 'Payroll runs and payslips',
    href: origin(process.env.NEXT_PUBLIC_PAYROLL_ORIGIN, 'http://localhost:3003'),
    initial: 'P',
    tint: '#b45309',
  },
].filter((product) => Boolean(product.href));

export default { ACCOUNTS_ORIGIN, PRODUCTS };
