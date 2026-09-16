'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LandingDoodle } from '@/components/LandingDoodle';
import { auth, signInWithTexor } from '@/lib/api';
import { ACCOUNTS_ORIGIN } from '@/lib/ecosystem';

/**
 * The public front door.
 *
 * Deliberately self-contained: its own stylesheet, its own type scale, its own
 * palette. The application behind it is purple and dense; this is blue and
 * airy, and the two should be able to change without disturbing each other.
 * Nothing here imports from the app's design tokens for that reason.
 */

// No Pricing: there is no billing behind it, so it would lead nowhere.
const NAV = ['Product', 'Solutions', 'Resources'];

export function Landing() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);

  /**
   * Whether anybody is signed in.
   *
   * `undefined` until the answer arrives, so the header can hold its place
   * rather than showing "Sign in" to somebody who is signed in and then
   * swapping it out under them.
   */
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    auth.me()
      .then(({ user: who }) => { if (!cancelled) setUser(who ?? null); })
      // A public page must render for somebody with no session at all.
      .catch(() => { if (!cancelled) setUser(null); });
    return () => { cancelled = true; };
  }, []);

  /** A code typed here goes straight into the meeting it names. */
  function join(event) {
    event?.preventDefault();
    const wanted = code.trim().toLowerCase().replace(/\s+/g, '');
    if (!wanted) return setJoining(true);
    return router.push(`/meetings/${wanted}`);
  }

  return (
    <div className="lp">
      <header className="lp__header">
        <a className="lp__brand" href="/" aria-label="Texor Talk">
          {/* The supplied logo, as drawn. Its red, orange and periwinkle are
              the product's, and are not repeated in the page palette. This
              page is light at every theme, so it needs only the one file. */}
          <img className="lp__logo" src="/brand/talk-logo.svg" alt="Texor Talk" width="135" height="40" />
        </a>

        <nav className="lp__nav" aria-label="Main">
          {NAV.map((item) => (
            <a key={item} className="lp__nav-link" href={`#${item.toLowerCase()}`}>{item}</a>
          ))}
        </nav>

        <div className="lp__actions">
          {user === undefined ? (
            // A placeholder of the same size, so the header does not jump.
            <span className="lp__pending" aria-hidden="true" />
          ) : user ? (
            <button
              type="button"
              className="lp__me"
              onClick={() => router.push('/home')}
              title={`Signed in as ${user.displayName}`}
            >
              {user.picture
                ? <img src={user.picture} alt="" className="lp__me-face" />
                : (
                  <span className="lp__me-face lp__me-face--letter" aria-hidden="true">
                    {(user.displayName ?? '?').trim().charAt(0).toUpperCase()}
                  </span>
                )}
              <span className="lp__me-name">{(user.displayName ?? '').split(' ')[0]}</span>
            </button>
          ) : (
            <>
              <button type="button" className="lp__signin" onClick={() => signInWithTexor('/home')}>
                Sign in
              </button>
              <button type="button" className="lp__cta" onClick={() => router.push('/home')}>
                Get Started
              </button>
            </>
          )}
        </div>
      </header>

      <main className="lp__hero">
        <div className="lp__copy">
          {/*
            * The parent brand, said once and early.
            *
            * "Texor TALK" names the product; this names the family it belongs
            * to, and links to the account that carries somebody across all of
            * them. The globe in that mark is where this page's red, orange,
            * yellow, green and blue come from.
            */}
          <a className="lp__family" href={ACCOUNTS_ORIGIN || '/'} target="_blank" rel="noreferrer">
            <img src="/brand/texor.svg" alt="Texor" width="72" height="21" />
            <span>One account, every product</span>
          </a>

          <h1 className="lp__title">
            Talk.
            <br />
            Collaborate.
            <br />
            <span className="lp__title-accent">Move Forward.</span>
          </h1>

          <p className="lp__sub">
            Secure, high-quality video meetings for modern teams.
            <br />
            Built for productivity, designed for people.
          </p>

          <div className="lp__ctas">
            <button type="button" className="lp__btn lp__btn--primary" onClick={() => router.push('/home')}>
              Start a Meeting
              <ArrowIcon />
            </button>

            {/*
              * "Join with a Code" opens an input in place rather than moving to
              * another page. Somebody with a code in their hand has one thing to
              * do, and a navigation between them and doing it is a step that
              * earns nothing.
              */}
            {joining ? (
              <form className="lp__join" onSubmit={join}>
                <input
                  className="lp__join-input"
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="abc-defg-hij"
                  aria-label="Meeting code"
                  onBlur={() => { if (!code.trim()) setJoining(false); }}
                />
                <button type="submit" className="lp__join-go" disabled={!code.trim()}>Join</button>
              </form>
            ) : (
              <button type="button" className="lp__btn lp__btn--ghost" onClick={() => setJoining(true)}>
                Join with a Code
              </button>
            )}
          </div>

        </div>

        <div className="lp__art">
          {/*
            * A spectrum wash behind the drawing.
            *
            * The colours are the stops of the globe in the Texor mark, blurred
            * into a soft field. It gives the illustration air to sit in, and
            * puts the family's colour on the page without painting any control
            * with it.
            */}
          <span className="lp__wash" aria-hidden="true" />

          <LandingDoodle className="lp__doodle" />

          <div className="lp__badge">
            <span className="lp__badge-top">
              <WaveGlyph />
              <span className="lp__badge-faint">Better</span>
            </span>
            <strong className="lp__badge-line">Conversations</strong>
            <strong className="lp__badge-line">Brighter Work</strong>
          </div>

          <p className="lp__script">
            Talk beyond boundaries
            <UnderSwoosh />
          </p>
        </div>
      </main>

      {/*
        * The feature row is its own band, not part of the left column.
        *
        * Stacked with the eyebrow, the headline, the copy and two buttons, it
        * made one side of the page carry everything while the other held a
        * drawing. Across the full width it balances the two, and all four fit
        * on one line instead of three plus a stray.
        */}
      <section className="lp__strip">
        {/*
          * Icon beside label, not above it.
          *
          * Stacked, "Secure & Encrypted" and "Team Collaboration" wrapped to
          * two lines while the others sat on one, and the row read as ragged.
          * Side by side they are four even pills.
          *
          * Each tile takes a different stop from the Texor globe — the
          * family's colours, on decoration only.
          */}
        <ul className="lp__features">
          {[
            ['HD Video', <CameraGlyph key="c" />, 'red'],
            ['Secure & Encrypted', <ShieldGlyph key="s" />, 'amber'],
            ['Screen Sharing', <ScreenGlyph key="p" />, 'green'],
            ['Team Collaboration', <PeopleGlyph key="t" />, 'teal'],
          ].map(([label, glyph, tint]) => (
            <li className={`lp__feature lp__feature--${tint}`} key={label}>
              <span className="lp__feature-tile" aria-hidden="true">{glyph}</span>
              <span className="lp__feature-label">{label}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="lp__foot">
        <a className="lp__foot-brand" href={ACCOUNTS_ORIGIN || '/'} target="_blank" rel="noreferrer">
          <img src="/brand/texor.svg" alt="Texor" width="82" height="24" />
        </a>
        <p>
          Texor Talk is part of Texor. One account signs you in to every product in the family.
        </p>
      </footer>
    </div>
  );
}

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path d="M4 12h14m0 0-5.5-5.5M18 12l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CameraGlyph = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm14 4.2 3.3-2.3a.6.6 0 0 1 .95.5v7.2a.6.6 0 0 1-.95.5L18 13.8v-3.6Z" /></svg>
);

const ShieldGlyph = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2.2 20 5v6.3c0 4.7-3.2 8.8-8 10.5-4.8-1.7-8-5.8-8-10.5V5l8-2.8Zm0 7.3a1.9 1.9 0 0 0-1 3.5V15h2v-2a1.9 1.9 0 0 0-1-3.5Z" /></svg>
);

const ScreenGlyph = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v9h16V6H4Z" /></svg>
);

const PeopleGlyph = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.5.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM9 13c-3.3 0-6 1.7-6 3.8V19h12v-2.2c0-2.1-2.7-3.8-6-3.8Zm7.5.5c-.7 0-1.4.1-2 .3 1 .9 1.5 2 1.5 3v2.2H22V17c0-1.9-2.5-3.5-5.5-3.5Z" /></svg>
);

const WaveGlyph = () => (
  <svg className="lp__badge-wave" viewBox="0 0 26 20" width="24" height="18" aria-hidden="true" focusable="false">
    {[2, 7, 12, 17, 22].map((x, i) => {
      const h = [8, 14, 18, 12, 7][i];
      return <rect key={x} x={x} y={(20 - h) / 2} width="2.6" height={h} rx="1.3" fill="currentColor" />;
    })}
  </svg>
);

/** The hand-drawn underline beneath the script line. */
const UnderSwoosh = () => (
  <svg className="lp__swoosh" viewBox="0 0 220 14" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path
      d="M3 9c38-6 84-8 130-5 28 2 54 5 84 2"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
);

export default Landing;
