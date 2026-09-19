'use client';

import { ClockIcon } from '@/components/icons';

const WORDING = {
  created: 'created this note',
  edited: 'edited it',
  shared: (detail) => `shared it with ${detail}`,
  unshared: (detail) => `removed ${detail}`,
  labelled: 'changed its labels',
  archived: 'archived it',
  restored: 'took it out of the archive',
  trashed: 'moved it to the trash',
  synced: (detail) => `updated it from ${detail}`,
};

/** How long ago, in the words somebody would use. */
function ago(at) {
  const seconds = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr ago`;
  if (seconds < 7 * 86400) return `${Math.round(seconds / 86400)} days ago`;

  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * Who did what.
 *
 * The thing that makes a shared note comfortable to work in: when the text
 * changes under you, the answer to "who did that" is on the same screen. It is
 * not a version history — it says a note was edited, not what it said before.
 */
export function ActivityPanel({ activity }) {
  if (!activity) return <p className="meta">Loading…</p>;
  if (activity.length === 0) return <p className="meta">Nothing yet.</p>;

  return (
    <div className="trail">
      {activity.map((event, index) => {
        const wording = WORDING[event.action] ?? event.action;

        return (
          <div className="trail__row" key={`${event.at}-${index}`}>
            <span className="trail__dot" aria-hidden="true" />
            <div>
              <div className="trail__what">
                <strong>{event.actor?.name || 'Somebody'}</strong>{' '}
                {typeof wording === 'function' ? wording(event.detail) : wording}
              </div>
              <div className="trail__when">
                <ClockIcon /> {ago(event.at)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default ActivityPanel;
