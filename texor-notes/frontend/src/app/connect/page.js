'use client';

import { Suspense, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Loading, Logo } from '@/components/ui';
import { connections as connectionApi } from '@/lib/api';

/**
 * "Acme CRM wants to save notes to your Texor Notes."
 *
 * The consent step of the connect flow, and the reason a third-party app can
 * write into its *users'* accounts without any of them ever pasting a
 * credential anywhere. They are already signed in here with their Texor
 * Account, so this is a sentence and a button.
 *
 * The app is named by its key's public prefix, never the key itself — this URL
 * goes in a browser's address bar, which is not a place a credential belongs.
 */
export default function ConnectPage() {
  return (
    <Suspense>
      <AppShell>{() => <Connect />}</AppShell>
    </Suspense>
  );
}

function Connect() {
  const [asking, setAsking] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useState(null);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const app = search.get('app') ?? '';
    const redirectUri = search.get('redirect_uri') ?? '';
    setParams({ app, redirectUri, state: search.get('state') ?? '' });

    connectionApi.prompt(app, redirectUri)
      .then(({ app: found }) => setAsking(found))
      .catch((promptError) => setError(promptError.message));
  }, []);

  if (error) {
    return (
      <div className="empty">
        <h2>That link does not work</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!asking) return <Loading label="Checking who is asking" />;

  return (
    <div className="auth-shell">
      <main className="auth-card">
        <div className="auth-card__header stack stack--tight">
          <Logo />
          <h1>{asking.name} wants to save notes to your Texor Notes</h1>
          <p>
            It will be able to create and change the notes it writes, and nothing else. They arrive
            under a label called “{asking.name}”, and you can disconnect it at any time from
            Settings.
          </p>
        </div>

        <div className="stack">
          <Button
            block
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const { redirectTo } = await connectionApi.approve({
                  app: params.app,
                  redirectUri: params.redirectUri,
                });
                window.location.href = params.state
                  ? `${redirectTo}&state=${encodeURIComponent(params.state)}`
                  : redirectTo;
              } catch (approveError) {
                setError(approveError.message);
                setBusy(false);
              }
            }}
          >
            Connect {asking.name}
          </Button>

          <Button variant="ghost" block onClick={() => { window.location.href = '/notes'; }}>
            Not now
          </Button>
        </div>
      </main>
    </div>
  );
}
