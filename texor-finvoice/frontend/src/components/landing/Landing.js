'use client';

/**
 * The public front door.
 *
 * Self-contained, like Texor Talk's: its own stylesheet, type scale and
 * palette, so the page and the app behind it can change without disturbing
 * each other. It shares the family's shape — the same header, the same
 * eyebrow naming the account that carries somebody across every product, the
 * same hand-drawn illustration and script aside — in Finvoice's mint and paper
 * rather than Talk's blue.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { ACCOUNTS_ORIGIN, auth, signInWithTexor } from '@/lib/api';
import { LandingDoodle } from './LandingDoodle';

const NAV = [['Product', 'product'], ['Industries', 'industries'], ['How it works', 'how']];

const INDUSTRIES = [
  ['Car wash & detailing', 'car', 'Job cards, vehicles, packages by vehicle type'],
  ['Restaurant & café', 'utensils-crossed', 'Menu, tables, 80 mm receipts'],
  ['Electronics & appliances', 'tv', 'Serial numbers and warranties per unit'],
  ['Salon & spa', 'scissors', 'Appointments and a stylist on every line'],
  ['Auto service & garage', 'wrench', 'Estimates, parts and labour'],
  ['Agency & freelancer', 'pen-tool', 'Proposals, projects and retainers'],
  ['Retail store', 'store', 'Barcodes, MRP and stock alerts'],
  ['General business', 'briefcase-business', 'Neutral defaults you can shape'],
];

const FEATURES = [
  ['GST done right', 'receipt-indian-rupee', 'CGST, SGST and IGST by place of supply, HSN codes, and numbering that resets each financial year.'],
  ['Stock & warranties', 'package', 'Issue an invoice and the stock moves, the serial is recorded and the warranty starts — by itself.'],
  ['Send on WhatsApp', 'message-circle', 'Share a bill from your phone in one tap, or email it with the PDF attached. Your customer can pay by UPI.'],
  ['Your whole team', 'users', 'Attendance for everyone on the floor, and roles that decide who sees your margins.'],
];

const STEPS = [
  ['Pick your trade', 'Choose the template that matches your business. Finvoice renames its modules, fields and invoice layout to suit it.'],
  ['Bill in seconds', 'Scan a barcode or pick from your catalogue. GST, totals and the amount in words are worked out as you type.'],
  ['Get paid, and know', 'Send it, take the payment, watch what is owed. Warranties and stock keep themselves up to date.'],
];

export function Landing() {
  const router = useRouter();
  /** `undefined` until we know, so the header holds its place instead of swapping under somebody. */
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    auth.me()
      .then(({ user: who }) => { if (!cancelled) setUser(who ?? null); })
      // A public page has to render for somebody with no session at all.
      .catch(() => { if (!cancelled) setUser(null); });
    return () => { cancelled = true; };
  }, []);

  const enter = () => router.push('/start');

  return (
    <div className="lp">
      <header className="lp__header">
        <a className="lp__brand" href="/" aria-label="Texor Finvoice">
          <img className="lp__logo" src="/brand/finvoice-logo.svg" alt="Texor Finvoice" width="150" height="28" />
        </a>

        <nav className="lp__nav" aria-label="Main">
          {NAV.map(([label, id]) => <a key={id} className="lp__nav-link" href={`#${id}`}>{label}</a>)}
        </nav>

        <div className="lp__actions">
          {user === undefined ? (
            <span className="lp__pending" aria-hidden="true" />
          ) : user ? (
            <button type="button" className="lp__me" onClick={enter} title={`Signed in as ${user.displayName}`}>
              {user.picture
                ? <img src={user.picture} alt="" className="lp__me-face" />
                : <span className="lp__me-face lp__me-face--letter" aria-hidden="true">{(user.displayName ?? '?').trim().charAt(0).toUpperCase()}</span>}
              <span className="lp__me-name">Open Finvoice</span>
            </button>
          ) : (
            <>
              <button type="button" className="lp__signin" onClick={() => signInWithTexor('/start')}>Sign in</button>
              <button type="button" className="lp__cta" onClick={enter}>Get started</button>
            </>
          )}
        </div>
      </header>

      <main className="lp__hero">
        <div className="lp__copy">
          <a className="lp__family" href={ACCOUNTS_ORIGIN || '/'} target="_blank" rel="noreferrer">
            <img src="/brand/texor-logo.svg" alt="Texor" width="66" height="20" />
            <span>One account, every product</span>
          </a>

          <h1 className="lp__title">
            Bill it.
            <br />
            Track it.
            <br />
            <span className="lp__title-accent">Get paid.</span>
          </h1>

          {/* No hard break: it has to wrap by itself on a phone. */}
          <p className="lp__sub">
            GST invoices, stock, warranties and your team — in software that arranges itself around the trade you are actually in.
          </p>

          <div className="lp__ctas">
            <button type="button" className="lp__btn lp__btn--primary" onClick={enter}>
              Start billing
              <ArrowIcon />
            </button>
            <a className="lp__btn lp__btn--ghost" href="#industries">See your trade</a>
          </div>

          <p className="lp__note">Free while you set up · No card · Your Texor Account signs you in</p>
        </div>

        <div className="lp__art">
          <span className="lp__wash" aria-hidden="true" />
          <LandingDoodle className="lp__doodle" />

          {/*
            * One honest number from the product, drawn the way the dashboard
            * draws it: a single series, so it needs no legend, in one hue on
            * the dark card where mint carries enough contrast.
            */}
          <figure className="lp__stat" aria-hidden="true">
            <figcaption>
              <span className="lp__stat-label">Collected this week</span>
              <strong className="lp__stat-value">₹1,24,800</strong>
            </figcaption>
            <svg className="lp__spark" viewBox="0 0 168 56" preserveAspectRatio="none" focusable="false">
              {[26, 34, 22, 44, 38, 50, 56].map((h, i) => (
                <rect
                  key={h + i}
                  x={i * 24}
                  y={56 - h}
                  width="16"
                  height={h}
                  rx="4"
                  fill={i === 6 ? '#4addb1' : '#097a5e'}
                />
              ))}
            </svg>
          </figure>

          <p className="lp__script">
            Paperwork, sorted
            <UnderSwoosh />
          </p>
        </div>
      </main>

      <section className="lp__strip" id="product">
        <ul className="lp__pills">
          {[['GST-ready invoices', 'file-text'], ['Quotations that convert', 'file-pen-line'], ['Stock & serial numbers', 'boxes'], ['Warranty cards', 'shield-check']].map(([label, icon]) => (
            <li className="lp__pill" key={label}>
              <span className="lp__pill-tile" aria-hidden="true"><Icon name={icon} size={20} /></span>
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp__section" id="industries">
        <header className="lp__section-head">
          <h2>Built for your trade, not for “businesses”</h2>
          <p>Pick a template when you sign up. Finvoice renames its modules, changes its fields and redraws its invoice to match. Rename any of it afterwards — it is yours.</p>
        </header>
        <ul className="lp__grid">
          {INDUSTRIES.map(([name, icon, blurb]) => (
            <li className="lp__card" key={name}>
              <span className="lp__card-icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
              <strong>{name}</strong>
              <span className="lp__card-blurb">{blurb}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp__section lp__section--tint" id="how">
        <header className="lp__section-head">
          <h2>Three steps to your first invoice</h2>
        </header>
        <ol className="lp__steps">
          {STEPS.map(([title, blurb], i) => (
            <li key={title}>
              <span className="lp__step-no">{i + 1}</span>
              <strong>{title}</strong>
              <span>{blurb}</span>
            </li>
          ))}
        </ol>
        <div className="lp__section-cta">
          <button type="button" className="lp__btn lp__btn--primary" onClick={enter}>
            Set up your business
            <ArrowIcon />
          </button>
        </div>
      </section>

      <section className="lp__section">
        <ul className="lp__features">
          {FEATURES.map(([title, icon, blurb]) => (
            <li key={title}>
              <span className="lp__feature-icon" aria-hidden="true"><Icon name={icon} size={22} /></span>
              <div>
                <strong>{title}</strong>
                <p>{blurb}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <footer className="lp__foot">
        <a className="lp__foot-brand" href={ACCOUNTS_ORIGIN || '/'} target="_blank" rel="noreferrer">
          <img src="/brand/texor-logo.svg" alt="Texor" width="80" height="24" />
        </a>
        <p>Texor Finvoice is part of Texor. One account signs you in to every product in the family.</p>
      </footer>
    </div>
  );
}

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path d="M4 12h14m0 0-5.5-5.5M18 12l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The hand-drawn underline beneath the script line. */
const UnderSwoosh = () => (
  <svg className="lp__swoosh" viewBox="0 0 220 14" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path d="M3 9c38-6 84-8 130-5 28 2 54 5 84 2" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export default Landing;
