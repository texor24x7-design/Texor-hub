'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AppIcon, StatusPill } from '@/components/console/parts';
import { Alert, Loading } from '@/components/ui';
import { console_ } from '@/lib/api';

export default function DeveloperConsolePage() {
  return <AppShell><AppList /></AppShell>;
}

function AppList() {
  const [apps, setApps] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    console_.listApps()
      .then((data) => setApps(data.apps))
      .catch((loadError) => setError(loadError.message));
  }, []);

  return (
    <>
      <div className="row row--between row--wrap page-head">
        <div>
          <h1>Your apps</h1>
          <p>Apps you have registered to sign people in with their Texor Account.</p>
        </div>
        <a href="/console/new" className="btn btn--primary">Register an app</a>
      </div>

      <Alert kind="error">{error}</Alert>

      {apps === null ? (
        <Loading label="Loading your apps" />
      ) : apps.length === 0 ? (
        <section className="panel">
          <div className="empty">
            <h3>No apps yet</h3>
            <p style={{ marginTop: '0.5rem' }}>
              Register an app to get a client ID and secret, and let people sign in to it
              with Texor.
            </p>
            <p style={{ marginTop: '1rem' }}>
              <a href="/console/new" className="btn btn--primary">Register your first app</a>
            </p>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="list">
            {apps.map((app) => (
              <a className="app-card" key={app.clientId} href={`/console/${app.clientId}`}>
                <AppIcon app={app} />
                <div className="grow">
                  <strong>{app.clientName}</strong>
                  <div className="meta mono">{app.clientId}</div>
                </div>
                <StatusPill app={app} />
              </a>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
