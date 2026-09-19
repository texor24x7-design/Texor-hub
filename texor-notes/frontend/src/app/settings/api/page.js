'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ApiKeyManager } from '@/components/ApiKeyManager';
import { Button, Loading } from '@/components/ui';
import { API_ORIGIN, connections as connectionApi } from '@/lib/api';

/**
 * Where somebody wires their own software up to their notes — and takes it
 * apart again.
 *
 * The documentation is on the page rather than behind a link, because the
 * shortest path from "I have a key" to "a note appeared" is one request, and
 * printing it here means nobody has to go looking for it.
 */
export default function ApiSettingsPage() {
  return <AppShell>{() => <ApiSettings />}</AppShell>;
}

function ApiSettings() {
  const [connections, setConnections] = useState(null);

  async function load() {
    try {
      const { connections: rows } = await connectionApi.list();
      setConnections(rows);
    } catch {
      setConnections([]);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="board">
      <header className="board__head">
        <h1>The notes API</h1>
      </header>

      <section className="panel">
        <div className="panel__header">
          <h2>Your keys</h2>
          <p>A key lets another platform write notes into an account here, and read back the ones it wrote.</p>
        </div>
        <ApiKeyManager />
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Writing a note</h2>
          <p>One request. Send your own identifier as <code>externalId</code> and the same call updates it next time.</p>
        </div>
        <pre className="reveal" style={{ whiteSpace: 'pre-wrap' }}>
          <code>{`curl -X POST ${API_ORIGIN}/api/v1/notes \\
  -H "X-API-Key: ntk_live_…" \\
  -H "content-type: application/json" \\
  -d '{
        "externalId": "crm-deal-8812",
        "title": "Acme renewal",
        "colour": "yellow",
        "blocks": [
          { "type": "todo", "text": "Send the revised quote", "done": false }
        ]
      }'`}</code>
        </pre>
        <p className="meta">
          <code>GET /api/v1/me</code> answers with the app, the account it writes into and its
          label — worth calling first, before debugging anything else.
        </p>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Apps you have connected</h2>
          <p>Software that writes notes into your account on your behalf.</p>
        </div>

        {connections === null ? (
          <Loading label="Loading" />
        ) : connections.length === 0 ? (
          <p className="meta">None. An app asks for this the first time you connect it.</p>
        ) : (
          <div className="keys">
            {connections.map((connection) => (
              <div className="key" key={connection.id}>
                <div className="key__name">{connection.app}</div>
                <div className="key__meta">
                  connected {new Date(connection.connectedAt).toLocaleDateString()}
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await connectionApi.revoke(connection.id);
                      await load();
                    }}
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
