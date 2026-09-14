'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { SignInMethods } from '@/components/SignInMethods';
import { Alert, Button, Field } from '@/components/ui';
import { account } from '@/lib/api';

export default function SecurityPage() {
  return (
    <AppShell>
      {(user) => (
        <>
          <div className="page-head">
            <h1>Security</h1>
            <p>How you sign in, and where you are signed in.</p>
          </div>
          <SignInMethods user={user} />
          <ChangePassword user={user} />
          <ActiveSessions />
        </>
      )}
    </AppShell>
  );
}

function ChangePassword({ user }) {
  // An account created through Google has no password to confirm; holding a
  // valid session is the proof of ownership in that case.
  const settingFirstPassword = !user?.hasPassword;

  const [values, setValues] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [status, setStatus] = useState({ kind: null, message: null });
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setValues((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setStatus({ kind: null, message: null });
    setFieldErrors({});

    if (values.newPassword !== values.confirmPassword) {
      setFieldErrors({ confirmPassword: 'The two passwords do not match.' });
      return;
    }

    setBusy(true);
    try {
      await account.changePassword({
        currentPassword: settingFirstPassword ? undefined : values.currentPassword,
        newPassword: values.newPassword,
        signOutOtherSessions: !settingFirstPassword,
      });
      setValues({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setStatus({
        kind: 'success',
        message: settingFirstPassword
          ? 'Password set. You can now sign in with your email address too.'
          : 'Password changed. Other devices have been signed out.',
      });
    } catch (error) {
      setStatus({ kind: 'error', message: error.message });
      setFieldErrors(error.fieldErrors ?? {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>{settingFirstPassword ? 'Set a password' : 'Password'}</h2>
        <p>
          {settingFirstPassword
            ? 'Add a password so you can sign in with your email address as well as a connected provider.'
            : 'Changing your password signs you out everywhere else.'}
        </p>
      </div>

      <form className="stack" onSubmit={submit}>
        <Alert kind={status.kind}>{status.message}</Alert>

        {settingFirstPassword ? null : (
          <Field label="Current password" htmlFor="currentPassword" error={fieldErrors.currentPassword}>
            <input
              id="currentPassword" className="input" type="password" autoComplete="current-password"
              required value={values.currentPassword} onChange={set('currentPassword')}
            />
          </Field>
        )}

        <Field
          label="New password" htmlFor="newPassword" error={fieldErrors.newPassword}
          hint="At least 12 characters, with upper and lower case and a number."
        >
          <input
            id="newPassword" className="input" type="password" autoComplete="new-password"
            required value={values.newPassword} onChange={set('newPassword')}
          />
        </Field>

        <Field label="Confirm new password" htmlFor="confirmPassword" error={fieldErrors.confirmPassword}>
          <input
            id="confirmPassword" className="input" type="password" autoComplete="new-password"
            required value={values.confirmPassword} onChange={set('confirmPassword')}
          />
        </Field>

        <div>
          <Button type="submit" loading={busy}>
            {busy ? 'Saving…' : settingFirstPassword ? 'Set password' : 'Change password'}
          </Button>
        </div>
      </form>
    </section>
  );
}

function ActiveSessions() {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = () => account.sessions()
    .then((data) => setSessions(data.sessions))
    .catch((loadError) => setError(loadError.message));

  useEffect(() => { load(); }, []);

  async function revoke(id) {
    setBusy(id);
    try {
      await account.revokeSession(id);
      await load();
    } catch (revokeError) {
      setError(revokeError.message);
    } finally {
      setBusy(null);
    }
  }

  async function revokeOthers() {
    setBusy('all');
    try {
      await account.revokeOtherSessions();
      await load();
    } catch (revokeError) {
      setError(revokeError.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel">
      <div className="panel__header row row--between row--wrap">
        <div>
          <h2>Where you are signed in</h2>
          <p>Each entry is one browser holding a Texor session.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={revokeOthers} loading={busy === 'all'}>
          Sign out other devices
        </Button>
      </div>

      <Alert kind="error">{error}</Alert>

      {sessions === null ? (
        <p className="muted">Loading sessions…</p>
      ) : (
        <div className="list">
          {sessions.map((session) => (
            <div className="list__item" key={session.id}>
              <div className="grow">
                <strong>{describeUserAgent(session.userAgent)}</strong>
                <div className="meta">
                  {session.ip || 'unknown address'} · last active{' '}
                  {new Date(session.lastSeenAt).toLocaleString()}
                </div>
              </div>
              {session.current ? (
                <span className="badge">This device</span>
              ) : (
                <Button
                  variant="danger" size="sm"
                  onClick={() => revoke(session.id)} loading={busy === session.id}
                >
                  Sign out
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Good enough to tell one device from another without a UA-parsing dependency. */
function describeUserAgent(userAgent) {
  if (!userAgent) return 'Unknown device';

  const browser = /Edg\//.test(userAgent) ? 'Edge'
    : /Chrome\//.test(userAgent) ? 'Chrome'
      : /Safari\//.test(userAgent) ? 'Safari'
        : /Firefox\//.test(userAgent) ? 'Firefox'
          : 'Browser';

  const platform = /iPhone|iPad/.test(userAgent) ? 'iOS'
    : /Android/.test(userAgent) ? 'Android'
      : /Mac OS X/.test(userAgent) ? 'macOS'
        : /Windows/.test(userAgent) ? 'Windows'
          : /Linux/.test(userAgent) ? 'Linux'
            : 'Unknown OS';

  return `${browser} on ${platform}`;
}
