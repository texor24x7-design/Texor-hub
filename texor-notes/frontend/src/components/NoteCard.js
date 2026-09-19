'use client';

import { NoteBody } from '@/components/NoteEditor';
import { LockIcon, PeopleIcon, PinIcon } from '@/components/icons';

/**
 * A note on the board.
 *
 * Deliberately not a live preview of the document — `preview` and `stats` are
 * computed on the server and sent with the list, so drawing fifty cards costs
 * fifty strings rather than fifty parsed documents. The card shows what a
 * person recognises a note by: its first words, and the handful of facts that
 * tell them why it is not like the one beside it.
 */
export function NoteCard({ note, onOpen, onPin, labels = [] }) {
  const named = labels.filter((label) => note.labels?.includes(label.id));

  return (
    <div
      className="card"
      style={{ '--card-bg': `var(--note-${note.colour ?? 'default'})` }}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {note.title ? <div className="card__title">{note.title}</div> : null}

      <div className="card__preview">
        {note.preview || <span className="muted">Empty note</span>}
      </div>

      <div className="card__foot">
        {named.map((label) => (
          <span key={label.id} className="card__chip">
            <span className="card__dot" style={{ background: `var(--note-${label.colour})` }} />
            {label.name}
          </span>
        ))}

        {note.source ? <span className="card__chip card__chip--app">{note.source.app}</span> : null}

        {note.stats?.todo > 0 ? (
          <span>{note.stats.done}/{note.stats.todo} done</span>
        ) : null}

        {note.shared ? (
          <span title={`Shared with ${note.sharedWith} ${note.sharedWith === 1 ? 'person' : 'people'}`}>
            <PeopleIcon />
          </span>
        ) : null}

        {!note.isMine ? <span>{note.owner?.name}</span> : null}

        <span className="card__actions">
          {onPin ? (
            <button
              type="button"
              className={`card__action ${note.pinned ? 'card__action--on' : ''}`}
              aria-label={note.pinned ? 'Unpin this note' : 'Pin this note'}
              aria-pressed={note.pinned}
              // Otherwise the click opens the note underneath it.
              onClick={(event) => { event.stopPropagation(); onPin(!note.pinned); }}
            >
              <PinIcon />
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

/** The read-only rendering used where a card is not enough and an editor is too much. */
export function NotePreviewBody({ blocks }) {
  return <NoteBody blocks={blocks} />;
}

export default NoteCard;
