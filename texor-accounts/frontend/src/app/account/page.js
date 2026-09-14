'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AvatarUpload } from '@/components/AvatarUpload';
import { Alert, Button, Field } from '@/components/ui';
import { account } from '@/lib/api';

export default function ProfilePage() {
  return <AppShell>{(user, setUser) => <ProfileForm user={user} setUser={setUser} />}</AppShell>;
}

function ProfileForm({ user, setUser }) {
  const [values, setValues] = useState({
    givenName: user.givenName,
    familyName: user.familyName,
    phone: user.phone ?? '',
    zoneinfo: user.zoneinfo,
  });
  const [status, setStatus] = useState({ kind: null, message: null });
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setValues((prev) => ({ ...prev, [key]: event.target.value }));

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setStatus({ kind: null, message: null });

    try {
      const result = await account.updateProfile(values);
      setUser(result.user);
      setStatus({ kind: 'success', message: 'Profile updated.' });
    } catch (error) {
      setStatus({ kind: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Profile</h1>
        <p>How you appear across every Texor product.</p>
      </div>

      <section className="panel">
        <div className="panel__header">
          <h2>Picture</h2>
          <p>Shown wherever your account appears.</p>
        </div>
        <AvatarUpload user={user} onChange={setUser} />
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Your profile</h2>
          <p>This is what Texor products show other people. Changes apply everywhere.</p>
        </div>

        <form className="stack" onSubmit={save}>
          <Alert kind={status.kind}>{status.message}</Alert>

          <div className="row" style={{ gap: '0.75rem' }}>
            <div className="grow">
              <Field label="First name" htmlFor="givenName">
                <input id="givenName" className="input" value={values.givenName} onChange={set('givenName')} />
              </Field>
            </div>
            <div className="grow">
              <Field label="Last name" htmlFor="familyName">
                <input id="familyName" className="input" value={values.familyName} onChange={set('familyName')} />
              </Field>
            </div>
          </div>

          <Field
            label="Phone number" htmlFor="phone"
            hint="Optional. International format, like +14155550123."
          >
            <input id="phone" className="input" type="tel" placeholder="+14155550123"
              value={values.phone} onChange={set('phone')} />
          </Field>

          <Field label="Time zone" htmlFor="zoneinfo" hint="Used for dates and scheduling across products.">
            <input id="zoneinfo" className="input" value={values.zoneinfo} onChange={set('zoneinfo')} />
          </Field>

          <div>
            <Button type="submit" loading={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Account details</h2>
        </div>
        <div className="list">
          <div className="list__item">
            <div className="grow">
              <strong>Email</strong>
              <div className="meta">{user.email}</div>
            </div>
            <span className="badge">{user.emailVerified ? 'Verified' : 'Unverified'}</span>
          </div>
          <div className="list__item">
            <div className="grow">
              <strong>Phone</strong>
              <div className="meta">{user.phone || 'Not set'}</div>
            </div>
            {user.phone ? (
              <span className="badge">{user.phoneVerified ? 'Verified' : 'Unverified'}</span>
            ) : null}
          </div>
          <div className="list__item">
            <div className="grow">
              <strong>Texor account ID</strong>
              <div className="meta mono">{user.id}</div>
            </div>
          </div>
          <div className="list__item">
            <div className="grow">
              <strong>Created</strong>
              <div className="meta">{new Date(user.createdAt).toLocaleDateString()}</div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
