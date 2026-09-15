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
const origin = (value, fallback) => (value ?? fallback ?? '').replace(/\/$/, '');

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
