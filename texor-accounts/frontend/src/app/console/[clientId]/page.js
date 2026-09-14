'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { AppIcon, Credential, SecretReveal, StatusPill, UriList } from '@/components/console/parts';
import { Alert, Button, Field, Loading } from '@/components/ui';
import { console_ } from '@/lib/api';

const TABS = [
  { id: 'settings', label: 'Settings' },
  { id: 'credentials', label: 'Credentials' },
  { id: 'testers', label: 'Test accounts' },
  { id: 'publishing', label: 'Publishing' },
];

export default function AppDetailPage({ params }) {
  const { clientId } = use(params);
  return <AppShell><AppDetail clientId={clientId} /></AppShell>;
}

function AppDetail({ clientId }) {
  const router = useRouter();
  const [app, setApp] = useState(null);
  const [testerEmails, setTesterEmails] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [tab, setTab] = useState('settings');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const [{ app: loaded, testAccountEmails }, catalogue] = await Promise.all([
        console_.getApp(clientId),
        console_.scopes(),
      ]);
      setApp(loaded);
      setTesterEmails(testAccountEmails ?? []);
      setScopes(catalogue.scopes ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  if (error && !app) {
    return (
      <>
        <a href="/console" className="meta">&larr; Back to your apps</a>
        <div style={{ marginTop: '1rem' }}><Alert kind="error">{error}</Alert></div>
      </>
    );
  }

  if (!app) return <Loading label="Loading app" />;

  const shared = { app, setApp, setNotice, setError, reload: load };

  return (
    <>
      <div style={{ marginBottom: '1.5rem' }}>
        <a href="/console" className="meta">&larr; Back to your apps</a>
        <div className="row" style={{ marginTop: '0.75rem', gap: '0.9rem' }}>
          <AppIcon app={app} />
          <div className="grow">
            <div className="row">
              <h2>{app.clientName}</h2>
              <StatusPill app={app} />
            </div>
            <div className="meta mono">{app.clientId}</div>
          </div>
        </div>
      </div>

      {notice ? <div style={{ marginBottom: '1rem' }}><Alert kind="success">{notice}</Alert></div> : null}
      <Alert kind="error">{error}</Alert>

      <div className="tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id} type="button" role="tab"
            aria-selected={tab === entry.id} onClick={() => { setTab(entry.id); setNotice(null); }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'settings' ? <SettingsTab {...shared} scopes={scopes} /> : null}
      {tab === 'credentials' ? <CredentialsTab {...shared} /> : null}
      {tab === 'testers' ? <TestersTab {...shared} emails={testerEmails} setEmails={setTesterEmails} /> : null}
      {tab === 'publishing' ? <PublishingTab {...shared} onDeleted={() => router.push('/console')} /> : null}
    </>
  );
}

function SettingsTab({ app, setApp, setNotice, setError, scopes }) {
  const [values, setValues] = useState({
    clientName: app.clientName,
    description: app.description,
    appUrl: app.appUrl,
    logoUri: app.logoUri,
    policyUri: app.policyUri,
    tosUri: app.tosUri,
    supportEmail: app.supportEmail,
    redirectUris: app.redirectUris.length ? app.redirectUris : [''],
    postLogoutRedirectUris: app.postLogoutRedirectUris,
    allowedScopes: app.allowedScopes,
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setValues((prev) => ({ ...prev, [key]: event.target.value }));

  const toggleScope = (id) => setValues((prev) => ({
    ...prev,
    allowedScopes: prev.allowedScopes.includes(id)
      ? prev.allowedScopes.filter((scope) => scope !== id)
      : [...prev.allowedScopes, id],
  }));

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});

    try {
      const { app: updated } = await console_.updateApp(app.clientId, {
        ...values,
        redirectUris: values.redirectUris.map((uri) => uri.trim()).filter(Boolean),
        postLogoutRedirectUris: values.postLogoutRedirectUris.map((uri) => uri.trim()).filter(Boolean),
      });
      setApp(updated);
      setNotice('Changes saved.');
    } catch (saveError) {
      setError(saveError.message);
      setFieldErrors(saveError.fieldErrors ?? {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack stack--loose" onSubmit={save}>
      <section className="panel">
        <div className="panel__header">
          <h2>Consent screen</h2>
          <p>What people see when the app asks for access to their Texor Account.</p>
        </div>

        <div className="stack">
          <Field label="App name" htmlFor="clientName" error={fieldErrors.clientName}>
            <input id="clientName" className="input" required value={values.clientName} onChange={set('clientName')} />
          </Field>
          <Field label="Description" htmlFor="description">
            <input id="description" className="input" value={values.description} onChange={set('description')} />
          </Field>
          <Field label="Logo URL" htmlFor="logoUri" hint="A square image works best." error={fieldErrors.logoUri}>
            <input id="logoUri" className="input" type="url" value={values.logoUri} onChange={set('logoUri')} />
          </Field>
          <Field label="Homepage" htmlFor="appUrl" error={fieldErrors.appUrl}>
            <input id="appUrl" className="input" type="url" value={values.appUrl} onChange={set('appUrl')} />
          </Field>
          <Field label="Privacy policy" htmlFor="policyUri" hint="Required before an app can be published." error={fieldErrors.policyUri}>
            <input id="policyUri" className="input" type="url" value={values.policyUri} onChange={set('policyUri')} />
          </Field>
          <Field label="Terms of service" htmlFor="tosUri" error={fieldErrors.tosUri}>
            <input id="tosUri" className="input" type="url" value={values.tosUri} onChange={set('tosUri')} />
          </Field>
          <Field label="Support email" htmlFor="supportEmail" error={fieldErrors.supportEmail}>
            <input id="supportEmail" className="input" type="email" value={values.supportEmail} onChange={set('supportEmail')} />
          </Field>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Redirect URIs</h2>
          <p>
            Compared as exact strings. <code>https://example.com/cb</code> and{' '}
            <code>https://example.com/cb/</code> are different URIs — register whichever your
            app actually sends.
          </p>
        </div>

        <div className="stack stack--loose">
          <UriList
            label="Authorized redirect URIs"
            hint="Where Texor sends people back after they sign in. https only, except on localhost."
            values={values.redirectUris}
            error={fieldErrors.redirectUris}
            onChange={(redirectUris) => setValues((prev) => ({ ...prev, redirectUris }))}
          />

          <UriList
            label="Post-logout redirect URIs"
            hint="Where Texor sends people after they sign out. Leave empty if your app does not sign people out of Texor."
            values={values.postLogoutRedirectUris}
            error={fieldErrors.postLogoutRedirectUris}
            onChange={(postLogoutRedirectUris) => setValues((prev) => ({ ...prev, postLogoutRedirectUris }))}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Access</h2>
          <p>What the app may ask people for.</p>
        </div>
        <div className="list">
          {scopes.map((scope) => (
            <label className="list__item" key={scope.id} style={{ cursor: scope.required ? 'default' : 'pointer' }}>
              <input
                type="checkbox"
                checked={scope.required || values.allowedScopes.includes(scope.id)}
                disabled={scope.required}
                onChange={() => toggleScope(scope.id)}
              />
              <div className="grow">
                <strong>{scope.title}</strong>
                <div className="meta">{scope.description}</div>
              </div>
              {scope.required ? <span className="pill pill--testing">Always</span> : null}
            </label>
          ))}
        </div>
      </section>

      <div><Button type="submit" loading={busy}>{busy ? 'Saving…' : 'Save changes'}</Button></div>
    </form>
  );
}

function CredentialsTab({ app, setApp, setNotice, setError }) {
  const [secret, setSecret] = useState(null);
  const [busy, setBusy] = useState(false);

  async function rotate() {
    if (!window.confirm('Rotate the client secret? The current one stops working immediately.')) return;

    setBusy(true);
    setError(null);
    try {
      const result = await console_.rotateSecret(app.clientId);
      setApp(result.app);
      setSecret(result.clientSecret);
      setNotice(null);
    } catch (rotateError) {
      setError(rotateError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel__header">
          <h2>Credentials</h2>
          <p>What your app uses to identify itself to Texor.</p>
        </div>

        <div className="stack">
          <SecretReveal secret={secret} onDismiss={() => setSecret(null)} />

          <Credential label="Client ID" value={app.clientId} />

          {app.hasSecret ? (
            <div className="field">
              <span className="field__label">Client secret</span>
              <div className="credential">
                <code>Stored encrypted — shown only once, when created or rotated.</code>
                <Button type="button" variant="secondary" size="sm" onClick={rotate} loading={busy}>
                  Rotate
                </Button>
              </div>
              {app.secretRotatedAt ? (
                <span className="field__hint">
                  Last set {new Date(app.secretRotatedAt).toLocaleString()}
                </span>
              ) : null}
            </div>
          ) : (
            <Alert kind="info">
              This is a public app, so it has no client secret. It must use PKCE.
            </Alert>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Endpoints</h2>
          <p>Point your OpenID Connect library at the discovery document; it finds the rest.</p>
        </div>
        <div className="stack stack--tight">
          <Credential label="Issuer" value={app.endpoints.issuer} />
          <Credential label="Discovery" value={app.endpoints.discovery} />
          <Credential label="Authorization" value={app.endpoints.authorization} />
          <Credential label="Token" value={app.endpoints.token} />
          <Credential label="UserInfo" value={app.endpoints.userinfo} />
        </div>
      </section>
    </>
  );
}

function TestersTab({ app, setApp, setNotice, setError, emails, setEmails }) {
  const [text, setText] = useState(emails.join('\n'));
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState([]);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setUnknown([]);

    try {
      const result = await console_.setTestAccounts(
        app.clientId,
        text.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean),
      );
      setApp(result.app);
      setEmails(result.testAccountEmails);
      setText(result.testAccountEmails.join('\n'));
      setUnknown(result.unknown ?? []);
      setNotice('Test accounts updated.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Test accounts</h2>
        <p>
          While the app is in testing, only you and these accounts can sign in to it.
          Everyone else is turned away.
        </p>
      </div>

      <div className="stack">
        {unknown.length ? (
          <Alert kind="error">
            No Texor Account for: {unknown.join(', ')}. They need to create one before they can test.
          </Alert>
        ) : null}

        <Field
          label="Email addresses"
          htmlFor="testers"
          hint="One per line. Each needs an existing Texor Account."
        >
          <textarea
            id="testers" className="input" rows={8}
            value={text} onChange={(event) => setText(event.target.value)}
          />
        </Field>

        <div><Button onClick={save} loading={busy}>{busy ? 'Saving…' : 'Save test accounts'}</Button></div>
      </div>
    </section>
  );
}

function PublishingTab({ app, setApp, setNotice, setError, onDeleted }) {
  const [busy, setBusy] = useState(null);

  async function submit() {
    setBusy('review');
    setError(null);
    try {
      const { app: updated } = await console_.submitForReview(app.clientId);
      setApp(updated);
      setNotice('Submitted. Texor will review the app and get back to you.');
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${app.clientName}? Anyone signed in through it is signed out, and this cannot be undone.`)) return;

    setBusy('delete');
    try {
      await console_.deleteApp(app.clientId);
      onDeleted();
    } catch (deleteError) {
      setError(deleteError.message);
      setBusy(null);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel__header">
          <h2>Publishing</h2>
          <p>Where this app is in its journey to being available to everyone.</p>
        </div>

        <div className="stack">
          {app.publishingStatus === 'testing' ? (
            <>
              <Alert kind="info">
                <strong>Testing.</strong> Only you and your listed test accounts can sign in.
                Everyone else is turned away, and the consent screen warns that Texor has not
                reviewed the app.
              </Alert>
              {app.reviewNotes ? (
                <Alert kind="error">
                  <strong>From the last review:</strong> {app.reviewNotes}
                </Alert>
              ) : null}
              <div>
                <Button onClick={submit} loading={busy === 'review'}>Submit for review</Button>
              </div>
              <p className="meta">
                A homepage, privacy policy and support email are required before review.
              </p>
            </>
          ) : null}

          {app.publishingStatus === 'in_review' ? (
            <Alert kind="info">
              <strong>In review.</strong> Submitted{' '}
              {app.submittedForReviewAt ? new Date(app.submittedForReviewAt).toLocaleDateString() : ''}.
              Your test accounts can keep using the app while you wait.
            </Alert>
          ) : null}

          {app.publishingStatus === 'published' ? (
            <Alert kind="success">
              <strong>Published.</strong> Anyone with a Texor Account can sign in to this app.
            </Alert>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Delete this app</h2>
          <p>Its credentials stop working immediately and everyone signed in through it is signed out.</p>
        </div>
        <Button variant="danger" onClick={remove} loading={busy === 'delete'}>
          Delete {app.clientName}
        </Button>
      </section>
    </>
  );
}
