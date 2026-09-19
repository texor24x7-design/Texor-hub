'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { MeetingAccessFields } from '@/components/MeetingAccessFields';
import { CloseIcon } from '@/components/icons';
import { meetings as meetingApi } from '@/lib/api';

/**
 * What an instant meeting is called when nobody says otherwise.
 *
 * A display name comes from an identity provider and may not be a string, which
 * is the assumption that has already crashed this product once.
 */
export function defaultMeetingTitle(user) {
  const first = (typeof user?.displayName === 'string' ? user.displayName : '').split(' ')[0];
  return first ? `${first}'s meeting` : 'New meeting';
}

/**
 * The two questions worth asking before a room opens.
 *
 * Starting a meeting used to create one straight from the button with `access:
 * 'texor'` baked in, so the only way to discover who could walk in was to open
 * the details page afterwards — by which time the link had usually been sent.
 * Asking here costs one click and is the difference between a private
 * conversation and an open one.
 *
 * The waiting room deliberately offers "whatever my organisation says" as well,
 * and leaves `lobby` out of the request when that is chosen: an admin who set
 * the default to "everyone knocks" should not have it quietly undone by a host
 * who never touched the field.
 */
export function StartMeetingDialog({
  defaultTitle,
  defaultAccess = 'texor',
  channelId = null,
  onClose,
  onStarted,
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [access, setAccess] = useState(defaultAccess);
  const [lobby, setLobby] = useState('');
  /** The organisation's rules, which can overrule two of the answers below. */
  const [org, setOrg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef(null);

  /**
   * Escape closes, and focus starts inside rather than wherever it was.
   *
   * Once, on mount. `onClose` is an inline arrow at every call site, so a
   * dependency on it re-ran this on *every* render of the page underneath —
   * and the meetings list and the home page both poll every ten seconds. Each
   * of those renders pulled focus back to the dialog, which shuts an open
   * `<select>` and drops the choice being made in it: the host picked "anyone
   * with the code", the field silently stayed on its default, and the meeting
   * was created as whatever they had not chosen.
   *
   * The handler is read through a ref so it stays current without re-running.
   */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    dialog.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * The waiting room starts on the organisation's default rather than on a
   * guess. If this never arrives the field stays empty and `lobby` is left out
   * of the request, which is the same default applied on the server.
   */
  useEffect(() => {
    let cancelled = false;
    meetingApi.defaults()
      .then(({ defaults }) => {
        if (cancelled) return;
        setOrg(defaults);
        setLobby((current) => current || defaults.lobby);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const { meeting } = await meetingApi.create({
        title: title.trim() || defaultTitle,
        access,
        // Omitted, not empty: the backend falls back to the org default only
        // when the field is absent.
        ...(lobby ? { lobby } : {}),
        ...(channelId ? { channelId } : {}),
      });
      onStarted(meeting);
    } catch (createError) {
      setError(createError.message);
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog__scrim"
      role="presentation"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <form
        className="dialog dialog--form"
        role="dialog"
        aria-modal="true"
        aria-label="Start a meeting"
        tabIndex={-1}
        ref={dialog}
        onSubmit={submit}
      >
        <div className="dialog__main">
          <button type="button" className="dialog__close" aria-label="Cancel" onClick={onClose}>
            <CloseIcon />
          </button>

          <div className="dialog__body">
            <h2>Start a meeting</h2>

            <Alert kind="error">{error}</Alert>

            <Field label="What is it" htmlFor="start-title">
              <input
                id="start-title"
                className="input"
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>

            <MeetingAccessFields
              idPrefix="start"
              access={access}
              lobby={lobby}
              org={org}
              onChange={(patch) => {
                if (patch.access !== undefined) setAccess(patch.access);
                if (patch.lobby !== undefined) setLobby(patch.lobby);
              }}
            />

            <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button type="submit" loading={busy}>Start</Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

export default StartMeetingDialog;
