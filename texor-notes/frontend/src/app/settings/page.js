'use client';

import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui';
import { ACCOUNTS_ORIGIN } from '@/lib/ecosystem';

/**
 * There is almost nothing to set here, and that is on purpose.
 *
 * The profile belongs to Texor Account — one place to change a name rather than
 * four that disagree — and everything else in this product is a property of a
 * note, set on the note.
 */
export default function SettingsPage() {
  return (
    <AppShell>
      {(user) => (
        <div className="board">
          <header className="board__head"><h1>Settings</h1></header>

          <section className="panel">
            <div className="panel__header">
              <h2>Your account</h2>
              <p>{user.displayName} · {user.email}</p>
            </div>
            <p className="meta">
              Your name and picture come from your Texor Account, so changing them there changes
              them everywhere.
            </p>
            {ACCOUNTS_ORIGIN ? (
              <div className="row" style={{ marginTop: '0.75rem' }}>
                <Button variant="secondary" onClick={() => { window.location.href = ACCOUNTS_ORIGIN; }}>
                  Manage your Texor Account
                </Button>
              </div>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel__header">
              <h2>The notes API</h2>
              <p>Keys for your own software, and the apps you have connected.</p>
            </div>
            <div className="row">
              <Button onClick={() => { window.location.href = '/settings/api'; }}>Open</Button>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
