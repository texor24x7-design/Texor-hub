'use client';

import { API_ORIGIN } from '@/lib/api';
import { PRODUCTS } from '@/lib/ecosystem';

/**
 * The public page.
 *
 * Everything is namespaced under `.lp` with its own tokens, so the marketing
 * page and the application cannot break each other — the same arrangement the
 * other products use. It says what this is, shows the thing the product is
 * actually unusual for (an API), and gets out of the way.
 */
export function Landing() {
  return (
    <div className="lp">
      <header className="lp__bar">
        <a className="lp__brand" href="/">
          <img src="/brand/notes-logo.svg" alt="Texor Notes" height={28} />
        </a>
        <nav className="lp__nav">
          <a href="#api">For developers</a>
          <a className="lp__cta" href="/notes">Open Notes</a>
        </nav>
      </header>

      <section className="lp__hero">
        <div className="lp__copy">
          <h1>Everything you meant to remember.</h1>
          <p className="lp__lede">
            Write it down, put a label on it, share it with the people who need it. Your notes
            follow your Texor Account, so they are already here the first time you sign in.
          </p>
          <div className="lp__actions">
            <a className="lp__cta lp__cta--lg" href="/notes">Start writing</a>
            <a className="lp__ghost" href="#api">See the API</a>
          </div>
          <p className="lp__note">One Texor Account. No separate password.</p>
        </div>

        <div className="lp__art" aria-hidden="true">
          <div className="lp__card lp__card--yellow">
            <strong>Q3 launch</strong>
            <p>Ask Bo for the deck · pricing page copy · <mark>ship on the 14th</mark></p>
          </div>
          <div className="lp__card lp__card--blue">
            <strong>Standup — 18 Sep</strong>
            <p>From Texor Talk</p>
          </div>
          <div className="lp__card lp__card--green">
            <strong>Acme renewal</strong>
            <p>From Acme CRM</p>
          </div>
        </div>
      </section>

      <section className="lp__grid">
        {[
          ['Labels, not folders', 'A note can be under as many labels as it needs. Share a label and everything filed there goes with it.'],
          ['Written together', 'Share a note to read or to edit. Two people can work on one note, nobody overwrites anybody, and the note says who changed what.'],
          ['Yours to take', 'Any note downloads as Word, PDF, Markdown, HTML or plain text — built in your browser, never uploaded to be converted.'],
        ].map(([title, blurb]) => (
          <article className="lp__feature" key={title}>
            <h2>{title}</h2>
            <p>{blurb}</p>
          </article>
        ))}
      </section>

      <section className="lp__api" id="api">
        <div className="lp__copy">
          <h2>Your other software can write here too</h2>
          <p className="lp__lede">
            Create a key, and any platform you run can put notes into a Texor account — filed under
            a label named after it, and editable by the person they belong to. Send your own
            identifier and the same call updates the note next time.
          </p>
          <p className="lp__note">
            It is the same API Texor Talk uses to keep your meeting notes here.
          </p>
        </div>

        <pre className="lp__code">
          <code>{`curl -X POST ${API_ORIGIN}/api/v1/notes \\
  -H "X-API-Key: ntk_live_…" \\
  -d '{ "externalId": "crm-deal-8812",
        "title": "Acme renewal",
        "blocks": [
          { "type": "todo",
            "text": "Send the revised quote" }
        ] }'`}</code>
        </pre>
      </section>

      <footer className="lp__foot">
        <div className="lp__family">
          {PRODUCTS.filter((product) => product.id !== 'notes').map((product) => (
            <a key={product.id} href={product.href}>{product.name}</a>
          ))}
        </div>
        <p>Part of Texor — one account across every product.</p>
      </footer>
    </div>
  );
}

export default Landing;
