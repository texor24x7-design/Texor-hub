'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';

/** Where an app is in the publishing lifecycle. */
export function StatusPill({ app }) {
  if (app.isFirstParty) return <span className="pill pill--first_party">Texor product</span>;

  const label = { testing: 'Testing', in_review: 'In review', published: 'Published' }[app.publishingStatus]
    ?? app.publishingStatus;

  return <span className={`pill pill--${app.publishingStatus}`}>{label}</span>;
}

export function AppIcon({ app }) {
  const initial = (app.clientName ?? '?').trim()[0]?.toUpperCase() ?? '?';
  return (
    <span className="app-icon">
      {app.logoUri ? <img src={app.logoUri} alt="" /> : initial}
    </span>
  );
}

/**
 * A value with a copy button.
 *
 * Client ids and endpoints get pasted into config files constantly, and
 * hand-retyping them is where typos come from.
 */
export function Credential({ value, label }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the value is selectable either way.
    }
  }

  return (
    <div className="field">
      {label ? <span className="field__label">{label}</span> : null}
      <div className="credential">
        <code>{value}</code>
        <Button type="button" variant="ghost" size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

/** Edits a list of URLs — redirect URIs, mostly. */
export function UriList({ label, hint, values, onChange, error }) {
  const list = values.length ? values : [''];

  const update = (index, value) => onChange(list.map((entry, i) => (i === index ? value : entry)));
  const remove = (index) => onChange(list.filter((_, i) => i !== index));

  return (
    <div className="field">
      <span className="field__label">{label}</span>

      <div className="stack stack--tight">
        {list.map((value, index) => (
          <div className="uri-row" key={index}>
            <input
              className="input"
              placeholder="https://example.com/callback"
              value={value}
              onChange={(event) => update(index, event.target.value)}
            />
            <Button
              type="button" variant="ghost" size="sm"
              onClick={() => remove(index)} disabled={list.length === 1}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <div>
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...list, ''])}>
          Add URI
        </Button>
      </div>

      {error ? <span className="field__error">{error}</span> : null}
      {!error && hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

/**
 * The one-time reveal of a client secret.
 *
 * Shown after registration or rotation and never again — the server keeps only
 * an encrypted copy it will not hand back.
 */
export function SecretReveal({ secret, onDismiss }) {
  if (!secret) return null;

  return (
    <div className="alert alert--success" style={{ display: 'grid', gap: '0.75rem' }}>
      <strong>Copy your client secret now.</strong>
      <span>
        This is the only time it is shown. If you lose it you will have to rotate the secret,
        which stops the old one working immediately.
      </span>
      <Credential value={secret} />
      {onDismiss ? (
        <div>
          <Button type="button" variant="secondary" size="sm" onClick={onDismiss}>
            I have saved it
          </Button>
        </div>
      ) : null}
    </div>
  );
}
