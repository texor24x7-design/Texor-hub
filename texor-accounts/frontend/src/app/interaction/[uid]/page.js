'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { SocialButtons } from '@/components/SocialButtons';
import { Alert, Avatar, Button, CheckIcon, Loading, Logo, describeScope } from '@/components/ui';
import { interaction } from '@/lib/api';

/**
 * The page oidc-provider hands the browser to during an authorization request.
 *
 * It asks the backend what the provider wants and renders one of two things:
 * a sign-in prompt, or a consent screen. Both finish by POSTing back and then
 * navigating to `redirectTo`, which returns control to the provider — a full
 * navigation rather than a fetch, because the provider answers with a redirect
 * to the product's callback URL.
 */
export default function InteractionPage({ params }) {
  const { uid } = use(params);

  // A failed "Continue with Google" comes back here as ?error=, because the
  // callback from an upstream provider has nowhere else to report to.
  const [federationError, setFederationError] = useState(null);
  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get('error');
    if (error) {
      setFederationError(error);
      // Clear it so a refresh does not resurrect a stale message.
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  const load = useCallback(async () => {
    try {
      const data = await interaction.details(uid);
      setState({ status: 'ready', data, error: null });
    } catch (error) {
      setState({ status: 'failed', data: null, error: error.message });
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  // A full navigation, not router.push — the target is the provider's resume
  // endpoint, which replies with a redirect off to the product.
  const resume = (url) => { window.location.href = url; };

  if (state.status === 'loading') return <Loading label="Checking your Texor session" />;

  if (state.status === 'failed') {
    return (
      <div className="auth-shell">
        <main className="auth-card">
          <div className="auth-card__header stack stack--tight">
            <Logo />
            <h1>This sign-in link has expired</h1>
          </div>
          <Alert kind="error">{state.error}</Alert>
          <div className="auth-card__footer">
            Go back to the product and start again, or <a href="/account">open your Texor Account</a>.
          </div>
        </main>
      </div>
    );
  }

  const { prompt, client, user } = state.data;

  if (prompt.name === 'login') {
    return (
      <LoginPrompt
        uid={uid}
        client={client}
        user={user}
        providers={state.data.providers}
        federationError={federationError}
        onResume={resume}
      />
    );
  }

  if (prompt.name === 'consent') {
    // An app still in testing turns away anyone its developer has not listed.
    if (prompt.reasons?.includes('app_not_available')) {
      return <UnavailablePrompt uid={uid} client={client} user={user} onResume={resume} />;
    }
    return (
      <ConsentPrompt
        uid={uid}
        prompt={prompt}
        client={client}
        scopeDetails={state.data.scopeDetails}
        onResume={resume}
      />
    );
  }

  return (
    <div className="auth-shell">
      <main className="auth-card">
        <div className="auth-card__header stack stack--tight">
          <Logo />
          <h1>Unsupported step</h1>
        </div>
        <Alert kind="error">
          Texor Account does not know how to handle the “{prompt.name}” step yet.
        </Alert>
      </main>
    </div>
  );
}

function LoginPrompt({ uid, client, user, providers, federationError, onResume }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(federationError ?? null);

  const productName = client?.name ?? 'a Texor product';

  // Already signed in to Texor: offer one-tap continuation instead of a
  // password box. This is the path most users hit after the first product.
  async function continueAsCurrentUser() {
    setBusy(true);
    setError(null);
    try {
      const result = await interaction.login(uid, { useExistingSession: true });
      onResume(result.redirectTo);
    } catch (loginError) {
      setError(loginError.message);
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <main className="auth-card">
        <div className="auth-card__header stack stack--tight">
          <Logo />
          <h1>Sign in to continue</h1>
          <p>{productName} is asking you to sign in with your Texor Account.</p>
        </div>

        {user ? (
          <div className="stack">
            <Alert kind="error">{error}</Alert>

            <div className="list__item">
              <Avatar user={user} />
              <div className="grow">
                <strong>{user.displayName}</strong>
                <div className="meta">{user.email}</div>
              </div>
            </div>

            <Button block loading={busy} onClick={continueAsCurrentUser}>
              {busy ? 'Continuing…' : `Continue as ${user.givenName || user.displayName}`}
            </Button>

            <Button variant="ghost" block onClick={() => onResume(`/signin?next=/interaction/${uid}`)}>
              Use a different account
            </Button>

            {/* Passing the interaction uid is what makes a federated sign-in
                finish this authorization request and return the user to the
                product, rather than landing them on their Texor profile. */}
            <SocialButtons interactionUid={uid} layout="icons" label="or continue with" />
          </div>
        ) : (
          <div className="stack">
            <Alert kind="error">{error}</Alert>

            <AuthForm
              mode="signin"
              busyLabel="Signing in…"
              onSubmit={async (values) => {
                const result = await interaction.login(uid, values);
                onResume(result.redirectTo);
              }}
            />

            {providers?.length ? (
              <SocialButtons interactionUid={uid} layout="icons" label="or continue with" />
            ) : null}
          </div>
        )}

        <div className="auth-card__footer">
          New to Texor? <a href={`/signup?next=/interaction/${uid}`}>Create an account</a>
        </div>
      </main>
    </div>
  );
}

/**
 * The app exists, but it is not open to this account yet.
 *
 * Shown instead of a consent screen so nobody is asked to approve access to an
 * app they cannot use. Declining returns `access_denied` to the app, which is
 * the honest answer.
 */
function UnavailablePrompt({ uid, client, user, onResume }) {
  const [busy, setBusy] = useState(false);

  async function goBack() {
    setBusy(true);
    const result = await interaction.abort(uid).catch(() => null);
    if (result?.redirectTo) onResume(result.redirectTo);
    else onResume('/account');
  }

  return (
    <div className="auth-shell">
      <main className="auth-card">
        <div className="auth-card__header stack stack--tight">
          <Logo />
          <h1>{client?.name ?? 'This app'} is not available yet</h1>
        </div>

        <div className="stack">
          <Alert kind="info">
            This app is still in testing, so only the accounts its developer has added can sign
            in. {user?.email ? <>You are signed in as <strong>{user.email}</strong>.</> : null}
          </Alert>

          <p className="muted" style={{ fontSize: '0.875rem' }}>
            If you should have access, ask the developer to add this address as a test account.
            {client?.supportEmail ? <> You can reach them at {client.supportEmail}.</> : null}
          </p>

          <Button block onClick={goBack} loading={busy}>Back to the app</Button>
        </div>
      </main>
    </div>
  );
}

function ConsentPrompt({ uid, prompt, client, scopeDetails, onResume }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const missing = (prompt.details?.missingOIDCScope ?? []).filter((scope) => scope !== 'openid');
  // The server describes scopes from one catalogue; fall back to the local
  // copy only if an older response did not carry them.
  const scopes = missing.map((id) => {
    const described = scopeDetails?.find((entry) => entry.id === id);
    return described ?? { id, ...describeScope(id) };
  });
  const productName = client?.name ?? 'This app';
  const unverified = client && !client.firstParty && !client.verified;

  async function act(kind) {
    setBusy(kind);
    setError(null);
    try {
      const result = kind === 'allow'
        ? await interaction.confirm(uid, {})
        : await interaction.abort(uid);
      onResume(result.redirectTo);
    } catch (actError) {
      setError(actError.message);
      setBusy(null);
    }
  }

  return (
    <div className="auth-shell">
      <main className="auth-card">
        <div className="auth-card__header stack stack--tight">
          <Logo />
          <h1>{productName} wants access to your Texor Account</h1>
          {client?.appUrl ? <p className="meta">{new URL(client.appUrl).host}</p> : null}
        </div>

        <div className="stack">
          <Alert kind="error">{error}</Alert>

          {unverified ? (
            <Alert kind="error">
              <strong>Texor has not reviewed this app.</strong> It was built by a third-party
              developer. Continue only if you trust them with the access listed below.
            </Alert>
          ) : null}

          {scopes.length ? (
            <ul className="scopes">
              {scopes.map((scope) => (
                <li key={scope.id}>
                  <CheckIcon />
                  <span>
                    <strong>{scope.title}</strong>
                    {scope.description ?? scope.body}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{productName} is asking to confirm your identity.</p>
          )}

          <div className="row" style={{ gap: '0.6rem' }}>
            <Button variant="secondary" onClick={() => act('deny')} loading={busy === 'deny'}>
              Cancel
            </Button>
            <div className="grow">
              <Button block onClick={() => act('allow')} loading={busy === 'allow'}>
                Allow
              </Button>
            </div>
          </div>

          <p className="meta">
            You can withdraw this at any time from{' '}
            <a href="/account/apps">apps with access to your account</a>.
          </p>
        </div>

        {client?.policyUri || client?.tosUri ? (
          <div className="auth-card__footer">
            {client.policyUri ? <a href={client.policyUri}>Privacy policy</a> : null}
            {client.policyUri && client.tosUri ? ' · ' : null}
            {client.tosUri ? <a href={client.tosUri}>Terms of service</a> : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}
