'use client';

import { useState } from 'react';
import { LabelIcon, PlusIcon } from '@/components/icons';

/**
 * A person's labels, under the fixed four in the rail.
 *
 * Flat, because they are flat. The one affordance beyond navigating is making a
 * new one, inline — a label is worth about as much ceremony as a folder name,
 * and a dialog for it would be three clicks to say one word.
 */
export function LabelSidebar({ labels, activeId, onCreate }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setBusy(true);
    try {
      await onCreate(trimmed);
      setName('');
      setAdding(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <nav className="labels" aria-label="Labels">
      <div className="labels__head">
        <span>Labels</span>
        <button
          type="button"
          className="card__action"
          aria-label="New label"
          onClick={() => setAdding((was) => !was)}
        >
          <PlusIcon />
        </button>
      </div>

      {labels.map((label) => (
        <a
          key={label.id}
          href={`/labels/${label.id}`}
          className={`labels__item ${activeId === label.id ? 'labels__item--on' : ''}`}
        >
          <span className="card__dot" style={{ background: `var(--note-${label.colour})` }} />
          <span className="labels__name">{label.name}</span>
          {/* Somebody else's label, or an app's. Both are worth saying quietly. */}
          {!label.isMine ? <span className="labels__meta">shared</span> : null}
          {label.locked ? <span className="labels__meta">app</span> : null}
        </a>
      ))}

      {labels.length === 0 && !adding ? (
        <p className="meta" style={{ padding: '0.35rem 0.7rem' }}>
          None yet. Labels are how a note is found again.
        </p>
      ) : null}

      {adding ? (
        <form className="labels__new" onSubmit={submit}>
          <input
            className="input"
            autoFocus
            maxLength={60}
            placeholder="Label name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') setAdding(false); }}
          />
          <button type="submit" className="btn btn--secondary btn--sm" disabled={busy || !name.trim()}>
            Add
          </button>
        </form>
      ) : null}
    </nav>
  );
}

export default LabelSidebar;
