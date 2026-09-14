'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { ProviderMark, SocialButtons } from '@/components/SocialButtons';
import { account } from '@/lib/api';

/**
 * "How you sign in" — the password, plus any connected providers.
 *
 * The rule this screen has to make legible: an account must always keep at
 * least one way in. Disconnecting the last one is refused by the API, and the
 * button says so before the user tries.
 */
export function SignInMethods({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await account.identities());
      setError(null);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The connect flow is a full round trip to the provider, so it reports back
  // through query parameters rather than a promise.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get('linked');
    const failure = params.get('error');

    if (linked) setNotice(`${linked[0].toUpperCase()}${linked.slice(1)} connected to your Texor Account.`);
    if (failure) setError(failure);
    if (linked || failure) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function disconnect(provider, displayName) {
    if (!window.confirm(`Disconnect ${displayName} from your Texor Account?`)) return;

    setBusy(provider);
    setError(null);
    setNotice(null);

    try {
      await account.unlinkIdentity(provider);
      setNotice(`${displayName} disconnected.`);
      await load();
    } catch (unlinkError) {
      setError(unlinkError.message);
    } finally {
      setBusy(null);
    }
  }

  const identities = data?.identities ?? [];
  const connected = new Set(identities.map((identity) => identity.provider));
  const available = (data?.available ?? []).filter((provider) => !connected.has(provider.id));

  // With no password, the single remaining provider is the only way in.
  const onlyMethod = !data?.hasPassword && identities.length === 1;

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>How you sign in</h2>
        <p>Connect Google, Microsoft or LinkedIn to sign in without a password.</p>
      </div>

      <div className="stack">
        {notice ? <Alert kind="success">{notice}</Alert> : null}
        <Alert kind="error">{error}</Alert>

        {data === null ? (
          <p className="muted">Loading&hellip;</p>
        ) : (
          <>
            <div className="list">
              <div className="list__item method">
                <span className="method__icon" aria-hidden="true">🔑</span>
                <div className="grow">
                  <strong>Password</strong>
                  <div className="meta">
                    {data.hasPassword
                      ? `Sign in with ${user?.email ?? 'your email address'} and a password`
                      : 'Not set — you sign in with a connected provider'}
                  </div>
                </div>
                <span className="badge">{data.hasPassword ? 'Active' : 'Not set'}</span>
              </div>

              {identities.map((identity) => (
                <div className="list__item method" key={identity.provider}>
                  <span className="method__icon"><ProviderMark id={identity.provider} /></span>
                  <div className="grow">
                    <strong>{identity.displayName}</strong>
                    <div className="meta">
                      {identity.email || 'Connected'}
                      {identity.lastUsedAt ? ` · last used ${new Date(identity.lastUsedAt).toLocaleDateString()}` : null}
                    </div>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={busy === identity.provider}
                    disabled={onlyMethod}
                    title={onlyMethod ? 'Set a password first — this is your only way to sign in.' : undefined}
                    onClick={() => disconnect(identity.provider, identity.displayName)}
                  >
                    Disconnect
                  </Button>
                </div>
              ))}
            </div>

            {onlyMethod ? (
              <Alert kind="info">
                This is currently the only way into your account. Set a password below before
                disconnecting it.
              </Alert>
            ) : null}

            {available.length ? (
              <SocialButtons mode="link" next="/account/security" label="Connect another" />
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

export default SignInMethods;
