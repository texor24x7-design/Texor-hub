'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Alert, Loading, formatTimestamp } from '@/components/ui';
import { HighlightIcon, LockIcon, SearchIcon, ShareIcon, TodoIcon } from '@/components/icons';
import { notes as notesApi } from '@/lib/api';

/**
 * The Notes section — everything written in every meeting, after the fact.
 *
 * Grouped by meeting rather than listed flat. A note's whole reason for
 * existing is the conversation it came out of, and "what did we say in the
 * Tuesday review" is the question people actually arrive with.
 */
export default function NotesPage() {
  return <AppShell>{(user) => <Notes user={user} />}</AppShell>;
}

const SCOPES = [
  ['mine', 'My notes', 'Everything you wrote'],
  ['mentions', 'Mentioning me', 'Shared notes that tag you'],
  ['shared', 'Shared with me', 'Notes other people shared from your meetings'],
];

function Notes({ user }) {
  const router = useRouter();
  const [scope, setScope] = useState('mine');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async (nextScope, search) => {
    setError(null);
    try {
      const { notes: found } = await notesApi.list({ scope: nextScope, q: search || undefined });
      setRows(found);
    } catch (loadError) {
      setError(loadError.message);
      setRows([]);
    }
  }, []);

  useEffect(() => { load(scope, ''); }, [load, scope]);

  // Typing in the box should not be one request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => load(scope, query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query, scope, load]);

  /** Meetings, most recent first, each holding its notes. */
  const meetings = useMemo(() => {
    const grouped = new Map();

    for (const note of rows ?? []) {
      const existing = grouped.get(note.meetingCode);
      if (existing) existing.notes.push(note);
      else {
        grouped.set(note.meetingCode, {
          code: note.meetingCode,
          title: note.meetingTitle || 'Untitled meeting',
          at: note.meetingStartedAt ?? note.createdAt,
          notes: [note],
        });
      }
    }

    return [...grouped.values()].sort((left, right) => new Date(right.at) - new Date(left.at));
  }, [rows]);

  return (
    <div className="stack stack--loose">
      <section className="panel">
        <div className="panel__header">
          <h1>Notes</h1>
          <p>What you wrote down while you were in a meeting, kept afterwards.</p>
        </div>

        <div className="notes__controls">
          <div className="notes__tabs" role="tablist" aria-label="Which notes">
            {SCOPES.map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={scope === value}
                title={hint}
                className={`notes__tab ${scope === value ? 'notes__tab--on' : ''}`}
                onClick={() => setScope(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="notes__search">
            <SearchIcon />
            <input
              className="notes__search-input"
              placeholder="Search your notes"
              aria-label="Search notes"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        <Alert kind="error">{error}</Alert>
      </section>

      {rows === null ? <Loading label="Loading notes" /> : null}

      {rows !== null && meetings.length === 0 ? (
        <section className="panel notes__empty">
          <h2>{query ? 'Nothing matched' : 'No notes yet'}</h2>
          <p>
            {query
              ? 'Try a different word, or switch which notes you are looking at.'
              : 'Open the Notes panel during a meeting and start typing. Whatever you write stays here afterwards.'}
          </p>
        </section>
      ) : null}

      {meetings.map((meeting) => (
        <section className="panel" key={meeting.code}>
          <div className="panel__header">
            <h2>{meeting.title}</h2>
            <p className="meta">
              {meeting.at ? formatTimestamp(meeting.at) : 'No date'} · <span className="code">{meeting.code}</span>
            </p>
          </div>

          <div className="notes__grid">
            {meeting.notes.map((note) => (
              <button
                key={note.id}
                type="button"
                className="notes__card"
                onClick={() => router.push(`/notes/${note.id}`)}
              >
                <div className="notes__card-top">
                  <h3>{note.title || 'Untitled note'}</h3>
                  <span
                    className="notes__card-vis"
                    title={note.visibility === 'meeting' ? 'Shared with the meeting' : 'Only you can see this'}
                  >
                    {note.visibility === 'meeting' ? <ShareIcon /> : <LockIcon />}
                  </span>
                </div>

                <p className="notes__card-preview">{note.preview || 'Empty'}</p>

                <div className="notes__card-foot">
                  {!note.isMine ? <span className="badge">{note.owner.name}</span> : null}
                  {note.mentionsMe ? <span className="badge badge--accent">Mentions you</span> : null}
                  {note.stats.todo > 0 ? (
                    <span className="notes__stat" title="Action items">
                      <TodoIcon /> {note.stats.done}/{note.stats.todo}
                    </span>
                  ) : null}
                  {note.stats.highlights > 0 ? (
                    <span className="notes__stat" title="Highlights">
                      <HighlightIcon /> {note.stats.highlights}
                    </span>
                  ) : null}
                  <span className="notes__stat notes__stat--right">{note.stats.words} words</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
