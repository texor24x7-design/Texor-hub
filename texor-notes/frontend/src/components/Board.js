'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { LabelSidebar } from '@/components/LabelSidebar';
import { NoteCard } from '@/components/NoteCard';
import { Alert, Button, Loading } from '@/components/ui';
import { RestoreIcon, TrashIcon } from '@/components/icons';
import { labels as labelApi, notes as noteApi } from '@/lib/api';

/**
 * Every screen that is a wall of notes.
 *
 * The board, one label, shared with me, the archive and the trash are the same
 * page with a different filter — so they are one component with a scope rather
 * than five that drift apart. Only the empty state and what the cards do differ.
 */
export function Board({ scope = 'notes', labelId = null, title, blurb, search = '' }) {
  const router = useRouter();

  const [notes, setNotes] = useState(null);
  const [labels, setLabels] = useState([]);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');

  // Whether anything has ever arrived, so a failed refresh is not mistaken for
  // a failed load — the same rule Texor Talk's lists follow.
  const loaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const [{ notes: found }, { labels: all }] = await Promise.all([
        noteApi.list({ scope, label: labelId ?? undefined, q: search || undefined }),
        labelApi.list(),
      ]);
      loaded.current = true;
      setNotes(found);
      setLabels(all);
      setError(null);
    } catch (loadError) {
      if (loaded.current) return;
      setError(loadError.message);
      setNotes([]);
    }
  }, [scope, labelId, search]);

  useEffect(() => { load(); }, [load]);

  async function createNote(event) {
    event?.preventDefault();

    try {
      const { note } = await noteApi.create({
        title: draft.trim(),
        labels: labelId ? [labelId] : [],
      });
      router.push(`/notes/${note.id}`);
    } catch (createError) {
      setError(createError.message);
    }
  }

  async function pin(note, pinned) {
    // Optimistic: a pin that waits for a round trip feels broken, and the worst
    // case is a card that slides back when the refresh disagrees.
    setNotes((current) => current.map((row) => (row.id === note.id ? { ...row, pinned } : row)));
    try {
      await noteApi.save(note.id, { pinned });
      await load();
    } catch (saveError) {
      setError(saveError.message);
      await load();
    }
  }

  const pinned = (notes ?? []).filter((note) => note.pinned);
  const rest = (notes ?? []).filter((note) => !note.pinned);

  const sidebar = (
    <LabelSidebar
      labels={labels}
      activeId={labelId}
      onCreate={async (name) => {
        try {
          await labelApi.create({ name });
          await load();
        } catch (createError) {
          setError(createError.message);
        }
      }}
    />
  );

  return (
    <AppShell labels={sidebar}>
      {() => (
        <div className="board">
          <Alert kind="error">{error}</Alert>

          {scope === 'notes' && !search ? (
            <form className="composer" onSubmit={createNote}>
              <input
                className="composer__input"
                placeholder="Write a note…"
                aria-label="Write a note"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              {draft.trim() ? (
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <Button size="sm" type="submit">Open it</Button>
                </div>
              ) : null}
            </form>
          ) : null}

          <header className="board__head">
            <h1>{title}</h1>
            {notes ? (
              <span className="board__count">
                {notes.length === 0 ? 'Nothing here' : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
              </span>
            ) : null}
          </header>

          {notes === null ? (
            <Loading label="Loading your notes" />
          ) : notes.length === 0 ? (
            <div className="empty">
              <h2>{search ? 'Nothing matched' : 'Nothing here yet'}</h2>
              <p>{search ? `No note contains “${search}”. Mongo matches whole words, so try the beginning of one.` : blurb}</p>
              {scope === 'notes' && !search ? (
                <Button onClick={createNote}>Write the first one</Button>
              ) : null}
            </div>
          ) : (
            <>
              {pinned.length > 0 ? (
                <section className="board__section">
                  <p className="board__label">Pinned</p>
                  <div className="board__grid">
                    {pinned.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        labels={labels}
                        onOpen={() => router.push(`/notes/${note.id}`)}
                        onPin={scope === 'trash' ? undefined : (next) => pin(note, next)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="board__section">
                {pinned.length > 0 ? <p className="board__label">Everything else</p> : null}
                <div className="board__grid">
                  {rest.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      labels={labels}
                      onOpen={() => router.push(`/notes/${note.id}`)}
                      onPin={scope === 'trash' ? undefined : (next) => pin(note, next)}
                    />
                  ))}
                </div>
              </section>
            </>
          )}

          {scope === 'trash' && (notes ?? []).length > 0 ? (
            <p className="meta center">
              Open a note to put it back, or to delete it for good.
            </p>
          ) : null}
        </div>
      )}
    </AppShell>
  );
}

export default Board;
