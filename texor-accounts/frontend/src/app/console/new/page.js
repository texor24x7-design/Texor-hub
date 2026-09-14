'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { SecretReveal, UriList } from '@/components/console/parts';
import { Alert, Button, Field } from '@/components/ui';
import { console_ } from '@/lib/api';

export default function NewAppPage() {
  return <AppShell><RegisterApp /></AppShell>;
}

function RegisterApp() {
  const router = useRouter();
  const [catalogue, setCatalogue] = useState(null);
  const [values, setValues] = useState({
    clientName: '',
    description: '',
    appUrl: '',
    redirectUris: [''],
    allowedScopes: ['profile', 'email'],
    tokenEndpointAuthMethod: 'client_secret_basic',
  });
  const [created, setCreated] = useState(null);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    console_.scopes().then(setCatalogue).catch(() => setCatalogue({ scopes: [] }));
  }, []);

  const set = (key) => (event) => setValues((prev) => ({ ...prev, [key]: event.target.value }));

  const toggleScope = (id) => setValues((prev) => ({
    ...prev,
    allowedScopes: prev.allowedScopes.includes(id)
      ? prev.allowedScopes.filter((scope) => scope !== id)
      : [...prev.allowedScopes, id],
  }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const result = await console_.createApp({
        ...values,
        redirectUris: values.redirectUris.map((uri) => uri.trim()).filter(Boolean),
      });
      setCreated(result);
    } catch (submitError) {
      setError(submitError.message);
      setFieldErrors(submitError.fieldErrors ?? {});
      setBusy(false);
    }
  }

  // Registration succeeded: show the secret before moving on, because this is
  // the only time it exists in a readable form.
  if (created) {
    return (
      <>
        <div style={{ marginBottom: '1.5rem' }}>
          <h2>{created.app.clientName} is registered</h2>
          <p className="muted">Save the secret, then finish setting the app up.</p>
        </div>

        <section className="panel">
          <div className="stack">
            <SecretReveal secret={created.clientSecret} />
            <Button onClick={() => router.push(`/console/${created.app.clientId}`)}>
              Continue to the app
            </Button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <div style={{ marginBottom: '1.5rem' }}>
        <a href="/console" className="meta">&larr; Back to your apps</a>
        <h2 style={{ marginTop: '0.5rem' }}>Register an app</h2>
        <p className="muted">
          You will get a client ID and secret for signing people in with Texor.
        </p>
      </div>

      <form className="stack stack--loose" onSubmit={submit}>
        <Alert kind="error">{error}</Alert>

        <section className="panel">
          <div className="panel__header">
            <h2>About the app</h2>
            <p>The name and logo are shown to people when they are asked to sign in.</p>
          </div>

          <div className="stack">
            <Field label="App name" htmlFor="clientName" error={fieldErrors.clientName}>
              <input id="clientName" className="input" required maxLength={80}
                placeholder="Weather Widget" value={values.clientName} onChange={set('clientName')} />
            </Field>

            <Field label="Description" htmlFor="description" hint="One line about what the app does.">
              <input id="description" className="input" maxLength={500}
                value={values.description} onChange={set('description')} />
            </Field>

            <Field label="Homepage" htmlFor="appUrl" error={fieldErrors.appUrl}>
              <input id="appUrl" className="input" type="url" placeholder="https://example.com"
                value={values.appUrl} onChange={set('appUrl')} />
            </Field>
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>Redirect URIs</h2>
            <p>Where Texor sends people back after they sign in.</p>
          </div>

          <UriList
            label="Authorized redirect URIs"
            hint="Must match exactly, including the path. https only, except on localhost."
            values={values.redirectUris}
            error={fieldErrors.redirectUris}
            onChange={(redirectUris) => setValues((prev) => ({ ...prev, redirectUris }))}
          />
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>Access</h2>
            <p>What the app may ask people for. Request only what it actually needs.</p>
          </div>

          <div className="stack">
            <div className="list">
              {(catalogue?.scopes ?? []).map((scope) => (
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
                  {scope.sensitive ? <span className="pill pill--in_review">Needs review</span> : null}
                </label>
              ))}
            </div>

            <Field
              label="Client type"
              htmlFor="tokenEndpointAuthMethod"
              hint="Choose a public client only if the app cannot keep a secret, such as a single-page or mobile app."
            >
              <select id="tokenEndpointAuthMethod" className="input"
                value={values.tokenEndpointAuthMethod} onChange={set('tokenEndpointAuthMethod')}>
                <option value="client_secret_basic">Confidential — a server keeps the secret</option>
                <option value="none">Public — PKCE only, no secret</option>
              </select>
            </Field>
          </div>
        </section>

        <div className="row" style={{ gap: '0.6rem' }}>
          <Button type="submit" loading={busy}>{busy ? 'Registering…' : 'Register app'}</Button>
          <a href="/console" className="btn btn--ghost">Cancel</a>
        </div>
      </form>
    </>
  );
}
