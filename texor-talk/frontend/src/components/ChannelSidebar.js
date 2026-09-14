'use client';

import { useState } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { channels as channelApi } from '@/lib/api';

/** Channel switcher, plus the inline "new channel" form. */
export function ChannelSidebar({ list, activeId, onCreated }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const { channel } = await channelApi.create({ name, visibility, topic: '' });
      setName('');
      setCreating(false);
      onCreated?.(channel);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="panel" style={{ padding: '1rem' }}>
      <div className="row row--between" style={{ marginBottom: '0.75rem' }}>
        <h3>Channels</h3>
        <Button variant="ghost" size="sm" onClick={() => setCreating((open) => !open)}>
          {creating ? 'Cancel' : 'New'}
        </Button>
      </div>

      {creating ? (
        <form className="stack stack--tight" onSubmit={create} style={{ marginBottom: '1rem' }}>
          <Alert kind="error">{error}</Alert>
          <Field htmlFor="channelName">
            <input
              id="channelName" className="input" placeholder="design-team" required autoFocus
              value={name} onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field htmlFor="channelVisibility">
            <select
              id="channelVisibility" className="input"
              value={visibility} onChange={(event) => setVisibility(event.target.value)}
            >
              <option value="public">Public — anyone in Texor can join</option>
              <option value="private">Private — invite only</option>
            </select>
          </Field>
          <Button type="submit" size="sm" loading={busy}>Create channel</Button>
        </form>
      ) : null}

      <nav className="channel-list">
        {list.length === 0 ? (
          <p className="meta">No channels yet. Create the first one.</p>
        ) : (
          list.map((channel) => (
            <a
              key={channel._id}
              href={`/channels/${channel._id}`}
              aria-current={channel._id === activeId ? 'page' : undefined}
            >
              <span>
                {channel.visibility === 'private' ? '🔒 ' : '# '}
                {channel.slug}
              </span>
              {channel.messageCount ? <span className="meta">{channel.messageCount}</span> : null}
            </a>
          ))
        )}
      </nav>
    </aside>
  );
}

export default ChannelSidebar;
