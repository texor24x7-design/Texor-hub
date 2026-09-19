'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Field, Loading } from '@/components/ui';
import { KeyIcon } from '@/components/icons';
import { keys as keyApi } from '@/lib/api';

/**
 * Keys, from the inside.
 *
 * The screen has one job beyond listing: making it unmistakable that the key
 * shown after creating it is the only copy there will ever be. It is stored as
 * a hash, so this is not a policy that could be relaxed — there is genuinely
 * nothing to show a second time.
 */
export function ApiKeyManager() {
  const [keys, setKeys] = useState(null);
  const [error, setError] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [form, setForm] = useState({ appName: '', mode: 'owner', webhookUrl: '' });
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { keys: rows } = await keyApi.list();
      setKeys(rows);
    } catch (loadError) {
      setError(loadError.message);
      setKeys([]);
    }
  }

  useEffect(() => { load(); }, []);

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const created = await keyApi.create({
        appName: form.appName.trim(),
        mode: form.mode,
        ...(form.webhookUrl.trim() ? { webhookUrl: form.webhookUrl.trim() } : {}),
      });
      setFresh(created);
      setForm({ appName: '', mode: 'owner', webhookUrl: '' });
      await load();
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Alert kind="error">{error}</Alert>

      {fresh ? (
        <div className="reveal">
          <strong>Copy this now — it is not shown again.</strong>
          <code>{fresh.token}</code>
          {fresh.webhookSecret ? (
            <>
              <span className="meta">
                And the secret your server verifies our calls with, in the
                <code style={{ padding: '0 0.2rem' }}>X-Notes-Signature</code> header:
              </span>
              <code>{fresh.webhookSecret}</code>
            </>
          ) : null}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" variant="secondary" onClick={() => setFresh(null)}>I have it</Button>
          </div>
        </div>
      ) : null}

      <form className="stack" onSubmit={create}>
        <Field label="What is the app called" hint="Notes it writes are filed under a label with this name." htmlFor="app-name">
          <input
            id="app-name"
            className="input"
            required
            maxLength={60}
            placeholder="Acme CRM"
            value={form.appName}
            onChange={(event) => setForm((current) => ({ ...current, appName: event.target.value }))}
          />
        </Field>

        <Field
          label="Whose notes will it write"
          hint="Choose the second one when the app has its own users, and each of them should get their notes in their own Texor account."
          htmlFor="app-mode"
        >
          <select
            id="app-mode"
            className="input"
            value={form.mode}
            onChange={(event) => setForm((current) => ({ ...current, mode: event.target.value }))}
          >
            <option value="owner">Mine — everything it writes belongs to me</option>
            <option value="user">Its own users — each connects their Texor account once</option>
          </select>
        </Field>

        <Field
          label="Send changes back to (optional)"
          hint="A note edited here is posted to this address, signed, so the two stay in step."
          htmlFor="app-hook"
        >
          <input
            id="app-hook"
            className="input"
            type="url"
            placeholder="https://example.com/hooks/texor-notes"
            value={form.webhookUrl}
            onChange={(event) => setForm((current) => ({ ...current, webhookUrl: event.target.value }))}
          />
        </Field>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button type="submit" loading={busy} disabled={!form.appName.trim()}>Create a key</Button>
        </div>
      </form>

      {keys === null ? (
        <Loading label="Loading your keys" />
      ) : keys.length === 0 ? (
        <p className="meta">No keys yet.</p>
      ) : (
        <div className="keys">
          {keys.map((key) => (
            <div className={`key ${key.revokedAt ? 'key--revoked' : ''}`} key={key.id}>
              <KeyIcon />
              <div>
                <div className="key__name">{key.appName}</div>
                <div className="key__prefix">{key.prefix}…</div>
              </div>
              <div className="key__meta">
                {key.trusted ? 'trusted · ' : ''}
                {key.mode === 'user' ? 'writes for its own users' : 'writes to your account'}
                {key.lastUsedAt ? ` · last used ${new Date(key.lastUsedAt).toLocaleDateString()}` : ' · never used'}
              </div>
              <div style={{ marginLeft: 'auto' }}>
                {key.revokedAt ? (
                  <span className="meta">Revoked</span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      if (!window.confirm(`Revoke the key for ${key.appName}? It stops working immediately.`)) return;
                      await keyApi.revoke(key.id);
                      await load();
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ApiKeyManager;
