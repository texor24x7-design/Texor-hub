'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Avatar, Button, Field } from '@/components/ui';
import { CloseIcon } from '@/components/icons';
import { people as peopleApi } from '@/lib/api';

/**
 * Sharing a note, or a label.
 *
 * By email, always — there is no directory to pick from, and the suggestions
 * are people this person already shares something with. That is a deliberate
 * limit rather than a missing feature: a product where typing three letters
 * lists everybody in the company is a product that leaks its staff list.
 */
export function ShareDialog({ title, shares = [], onShare, onUnshare, onClose, canShare = true }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [suggestions, setSuggestions] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef(null);

  /**
   * Once, on mount. A dependency on `onClose` — an inline arrow at every call
   * site — would re-run this on every render of the page underneath and pull
   * focus back out of whatever was being typed into.
   */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    dialog.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      peopleApi.search(email)
        .then(({ people }) => { if (!cancelled) setSuggestions(people); })
        .catch(() => { if (!cancelled) setSuggestions([]); });
    }, 200);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [email]);

  async function submit(event) {
    event.preventDefault();
    if (!email.trim()) return;

    setBusy(true);
    setError(null);
    try {
      await onShare({ email: email.trim(), role });
      setEmail('');
    } catch (shareError) {
      setError(shareError.message);
    } finally {
      setBusy(false);
    }
  }

  const unshared = suggestions.filter(
    (person) => !shares.some((share) => share.email === person.email),
  );

  return (
    <div
      className="dialog__scrim"
      role="presentation"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        className="dialog dialog--form"
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${title}`}
        tabIndex={-1}
        ref={dialog}
      >
        <div className="dialog__main">
          <button type="button" className="dialog__close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>

          <div className="dialog__body">
            <h2>Share “{title}”</h2>

            <Alert kind="error">{error}</Alert>

            {canShare ? (
              <form className="share" onSubmit={submit}>
                <Field label="Email address" htmlFor="share-email">
                  <input
                    id="share-email"
                    className="input"
                    type="email"
                    autoFocus
                    placeholder="colleague@texor.app"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>

                {email && unshared.length > 0 ? (
                  <div className="share__suggest">
                    {unshared.slice(0, 5).map((person) => (
                      <button key={person.email} type="button" onClick={() => setEmail(person.email)}>
                        {person.name ? `${person.name} · ` : ''}{person.email}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="row" style={{ gap: '0.5rem' }}>
                  <select
                    className="input"
                    aria-label="What they can do"
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                  >
                    <option value="editor">Can edit</option>
                    <option value="viewer">Can read</option>
                  </select>
                  <Button type="submit" loading={busy} disabled={!email.trim()}>Share</Button>
                </div>
              </form>
            ) : (
              <p className="meta">Only the owner can change who this is shared with.</p>
            )}

            <div className="share">
              {shares.length === 0 ? (
                <p className="meta">Not shared with anybody yet.</p>
              ) : (
                shares.map((share) => (
                  <div className="share__row" key={share.email}>
                    <Avatar user={{ displayName: share.name || share.email }} />
                    <div className="share__who">
                      <strong>{share.name || share.email}</strong>
                      <span>
                        {share.email}
                        {/* Said plainly, or a share that has not landed looks broken. */}
                        {share.pending ? ' · waiting for them to sign in' : ''}
                      </span>
                    </div>
                    <span className="share__role meta">{share.role === 'editor' ? 'Can edit' : 'Can read'}</span>
                    {canShare ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onUnshare(share.email)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShareDialog;
