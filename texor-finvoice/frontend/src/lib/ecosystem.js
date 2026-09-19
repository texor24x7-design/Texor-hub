/**
 * Where the rest of Texor lives.
 *
 * Dev fallbacks apply only in development: an inlined fallback is never
 * absent, only wrong, and a deployment that forgot a variable would advertise
 * a sibling at localhost. In production an unset origin drops the product from
 * the switcher instead — a missing tile gets noticed and fixed.
 */
const DEV = process.env.NODE_ENV !== 'production';
const origin = (value, devFallback) => (value || (DEV ? devFallback : '')).replace(/\/$/, '');

export const ACCOUNTS_ORIGIN = origin(process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN, 'http://localhost:3000');

export const PRODUCTS = [
  { id: 'account', name: 'Texor Account', blurb: 'Profile, security and sign-in', href: ACCOUNTS_ORIGIN, icon: '/brand/accounts-icon.svg', initial: 'T', tint: '#226db4' },
  { id: 'finvoice', name: 'Finvoice', blurb: 'Invoicing and inventory', href: origin(process.env.NEXT_PUBLIC_FINVOICE_ORIGIN, 'http://localhost:3001'), icon: '/brand/finvoice-icon.svg', initial: 'F', tint: '#097a5e', current: true },
  { id: 'talk', name: 'Texor Talk', blurb: 'Meetings and messaging', href: origin(process.env.NEXT_PUBLIC_TALK_ORIGIN, 'http://localhost:3002'), icon: '/brand/talk-icon.svg', initial: 'T', tint: '#2e5cab' },
  { id: 'notes', name: 'Texor Notes', blurb: 'Notes, lists and shared thinking', icon: '/brand/notes-icon.svg', href: origin(process.env.NEXT_PUBLIC_NOTES_ORIGIN, 'http://localhost:3004'), initial: 'N', tint: '#c9821f' },
  { id: 'payroll', name: 'Payroll', blurb: 'Payroll runs and payslips', href: origin(process.env.NEXT_PUBLIC_PAYROLL_ORIGIN, 'http://localhost:3003'), initial: 'P', tint: '#b45309' },
].filter((product) => Boolean(product.href));
