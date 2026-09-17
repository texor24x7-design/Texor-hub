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
              {/* What the button does, not who is pressing it — the face already says that. */}
              <span className="lp__me-name">Open Talk</span>
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

          {/* No hard break: it has to wrap by itself on a phone. */}
          <p className="lp__sub">
            Secure, high-quality video meetings for modern teams. Built for productivity, designed for people.
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

          {/*
            * Three plain facts, where the column used to simply stop.
            *
            * The left side ended at the buttons while the drawing ran on for
            * another two hundred pixels, so the hero read as one full half and
            * one empty one.
            */}
          <ul className="lp__proof">
            {[
              ['Nothing to install', 'It runs in the browser you already have.'],
              ['Guests, not strangers', 'A lobby, knocking and host controls on every link.'],
              ['Your own server', 'The media never leaves the machine you run it on.'],
            ].map(([title, line]) => (
              <li key={title}>
                <TickGlyph />
                <span><strong>{title}</strong>{line}</span>
              </li>
            ))}
          </ul>
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
        * Four cards rather than four pills: the pills were a ragged row of
        * different widths floating under a hairline, and said only what the
        * product has, never what it is for. Each still takes one stop of the
        * Texor globe, on decoration only.
        */}
      <section className="lp__strip" id="product">
        <ul className="lp__features">
          {[
            ['HD Video', 'Crisp, low-latency calls that hold up on Indian broadband.', <CameraGlyph key="c" />, 'red'],
            ['Secure & Encrypted', 'Media stays on your own server, behind your own account.', <ShieldGlyph key="s" />, 'amber'],
            ['Screen Sharing', 'Show a deck, a design or a terminal without a download.', <ScreenGlyph key="p" />, 'green'],
            ['Team Collaboration', 'Channels, shared notes and files beside the call.', <PeopleGlyph key="t" />, 'teal'],
          ].map(([label, blurb, glyph, tint]) => (
            <li className={`lp__feature lp__feature--${tint}`} key={label}>
              <span className="lp__feature-tile" aria-hidden="true">{glyph}</span>
              <strong className="lp__feature-label">{label}</strong>
              <span className="lp__feature-blurb">{blurb}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp__section" id="solutions">
        <header className="lp__section-head">
          <h2>Everything the meeting needs, in the meeting</h2>
          <p>No second tab for notes, no third for the transcript, no fourth to find the link again.</p>
        </header>
        <ul className="lp__grid">
          {[
            ['Live captions', 'Spoken words appear as they are said, and stay as a transcript afterwards.', <CaptionGlyph key="cc" />],
            ['Shared notes', 'One document everyone in the room can write in, kept with the meeting.', <NoteGlyph key="n" />],
            ['Channels', 'Team conversation that carries on between calls.', <ChatGlyph key="ch" />],
            ['Calendar & invites', 'Schedule it, send it, and it lands in their calendar.', <CalendarGlyph key="cal" />],
            ['Lobby & roles', 'Decide who waits, who is admitted and who can host.', <LockGlyph key="l" />],
            ['Picture-in-picture', 'Keep the room in a corner while you work in another window.', <PipGlyph key="p" />],
          ].map(([title, blurb, glyph]) => (
            <li className="lp__card" key={title}>
              <span className="lp__card-icon" aria-hidden="true">{glyph}</span>
              <strong>{title}</strong>
              <span className="lp__card-blurb">{blurb}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp__band" id="resources">
        <header className="lp__section-head">
          <h2>A meeting is three steps away</h2>
        </header>
        <ol className="lp__steps">
          {[
            ['Start the room', 'One click makes a link. No scheduling, no add-on, no download.'],
            ['Share the link', 'Colleagues walk in with their Texor Account; guests knock and you let them in.'],
            ['Talk, and keep it', 'Captions, notes and decisions stay with the meeting after everybody leaves.'],
          ].map(([title, blurb], i) => (
            <li key={title}>
              <span className="lp__step-no">{i + 1}</span>
              <strong>{title}</strong>
              <span>{blurb}</span>
            </li>
          ))}
        </ol>
        <div className="lp__band-cta">
          <button type="button" className="lp__btn lp__btn--primary" onClick={() => router.push('/home')}>
            Start a Meeting
            <ArrowIcon />
          </button>
        </div>
      </section>

      <footer className="lp__foot">
        <a className="lp__foot-brand" href={ACCOUNTS_ORIGIN || '/'} target="_blank" rel="noreferrer">
          <img src="/brand/texor.svg" alt="Texor" width="82" height="24" />
        </a>
        <p>Texor Talk is part of Texor. One account signs you in to every product in the family.</p>
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

const TickGlyph = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="m5 12.5 4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

const CaptionGlyph = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3.5 5.5a2.5 2.5 0 0 0 0 5h1.8v-1.8H6.5a.7.7 0 1 1 0-1.4h1.8V10.5H6.5Zm7 0a2.5 2.5 0 0 0 0 5h1.8v-1.8h-1.8a.7.7 0 1 1 0-1.4h1.8V10.5h-1.8Z" /></svg>
);

const NoteGlyph = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 2h8l6 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm7 2v5h5l-5-5Zm-4 9h8v2H9v-2Zm0 4h8v2H9v-2Z" /></svg>
);

const ChatGlyph = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 5h10v2H7V8Zm0 4h7v2H7v-2Z" /></svg>
);

const CalendarGlyph = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 2v2h10V2h2v2h2a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2V2h2ZM4 9v11h16V9H4Zm3 3h4v4H7v-4Z" /></svg>
);

const LockGlyph = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2a5 5 0 0 1 5 5v2h1.5A1.5 1.5 0 0 1 20 10.5v9A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5v-9A1.5 1.5 0 0 1 5.5 9H7V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v2h6V7a3 3 0 0 0-3-3Zm0 9a1.8 1.8 0 0 0-1 3.3V18h2v-1.7A1.8 1.8 0 0 0 12 13Z" /></svg>
);

const PipGlyph = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v12h16V6H4Zm8 5h7v5h-7v-5Z" /></svg>
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
