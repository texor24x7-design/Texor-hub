'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, CheckIcon, describeScope } from '@/components/ui';
import { account } from '@/lib/api';

export default function AppsPage() {
  return <AppShell><ConnectedApps /></AppShell>;
}

function ConnectedApps() {
  const [apps, setApps] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = () => account.connectedApps()
    .then((data) => setApps(data.apps))
    .catch((loadError) => setError(loadError.message));

  useEffect(() => { load(); }, []);

  async function revoke(grantId, name) {
    if (!window.confirm(`Remove ${name}'s access to your Texor Account? You will be signed out of it.`)) return;

    setBusy(grantId);
    try {
      await account.revokeApp(grantId);
      await load();
    } catch (revokeError) {
      setError(revokeError.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Apps with access</h1>
        <p>Products you have signed in to with your Texor Account.</p>
      </div>

      <section className="panel">
      <div className="panel__header">
        <h2>Connected apps</h2>
        <p>Products you have signed in to with Texor. Removing one signs you out of it.</p>
      </div>

      <Alert kind="error">{error}</Alert>

      {apps === null ? (
        <p className="muted">Loading&hellip;</p>
      ) : apps.length === 0 ? (
        <p className="muted">You have not connected any Texor products yet.</p>
      ) : (
        <div className="list">
          {apps.map((app) => (
            <div className="list__item" key={app.grantId} style={{ alignItems: 'flex-start' }}>
              <div className="grow stack stack--tight">
                <div className="row row--between row--wrap">
                  <strong>{app.clientName}</strong>
                  <span className="meta">
                    Connected {new Date(app.grantedAt).toLocaleDateString()}
                  </span>
                </div>

                {app.appUrl ? <div className="meta">{new URL(app.appUrl).host}</div> : null}

                <ul className="scopes" style={{ marginTop: '0.35rem' }}>
                  {app.scopes.filter((scope) => scope !== 'openid').map((scope) => (
                    <li key={scope}>
                      <CheckIcon />
                      <span>{describeScope(scope).title}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Button
                variant="danger" size="sm"
                onClick={() => revoke(app.grantId, app.clientName)}
                loading={busy === app.grantId}
              >
                Remove access
              </Button>
            </div>
          ))}
        </div>
      )}
      </section>
    </>
  );
}
