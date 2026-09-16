'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Loading, formatTimestamp } from '@/components/ui';
import { LockIcon, ShareIcon, TrashIcon } from '@/components/icons';
import { NoteBody, NoteEditor } from '@/components/NoteEditor';
import { NoteDownload } from '@/components/NoteDownload';
import { notes as notesApi } from '@/lib/api';
import { saveLabel, useAutosave } from '@/lib/use-autosave';

/** One note: editable if it is yours, readable if somebody shared it with you. */
export default function NotePage({ params }) {
  const { id } = use(params);
  return <AppShell>{(user) => <NoteScreen id={id} user={user} />}</AppShell>;
}

function NoteScreen({ id }) {
  const router = useRouter();
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    notesApi.get(id)
      .then(({ note: found }) => { if (!cancelled) setNote(found); })
      .catch((loadError) => { if (!cancelled) setError(loadError.message); });
    return () => { cancelled = true; };
  }, [id]);

  const save = useCallback((draft) => notesApi.save(id, draft), [id]);
  const { state, error: saveError, queue, flushNow } = useAutosave(save);

  /**
   * The document as it is on screen, which is not the same as the one that was
   * loaded: autosave sends edits to the server but nothing sends them back, so
   * `note` stops being current the moment somebody types. A download built
   * from it would quietly be a few seconds behind the words on screen.
   */
  const [draft, setDraft] = useState(null);

  const edit = useCallback((next) => {
    setDraft(next);
    queue(next);
  }, [queue]);

  if (error) {
    return (
      <div className="panel">
        <Alert kind="error">{error}</Alert>
        <Button variant="secondary" onClick={() => router.push('/notes')} style={{ marginTop: '1rem' }}>
          Back to notes
        </Button>
      </div>
    );
  }

  if (!note) return <Loading label="Loading note" />;

  const shared = note.visibility === 'meeting';

  return (
    <div className="stack">
      <section className="panel note-page">
        <div className="row row--between row--wrap note-page__head">
          <div>
            <p className="meta">
              <a href={`/meetings/${note.meetingCode}/details`}>{note.meetingTitle || 'Untitled meeting'}</a>
              {note.meetingStartedAt ? ` · ${formatTimestamp(note.meetingStartedAt)}` : ''}
              {!note.canEdit ? ` · by ${note.owner.name}` : ''}
            </p>
          </div>

          <div className="row" style={{ gap: '0.5rem' }}>
            {note.canEdit ? (
              <span className={`note-page__state note-page__state--${state}`} role="status">
                {saveLabel(state)}
              </span>
            ) : null}

            {/* Offered on a note somebody shared with you as well as your own:
                being able to read it and not keep it would be an odd rule. */}
            <NoteDownload note={{ ...note, ...(draft ?? {}) }} />

            {note.canEdit ? (
              <>
                {/*
                  * Sharing is a deliberate act with a plain description of who
                  * ends up able to read it. "Share" on its own leaves people
                  * guessing whether it means the organisation or the room.
                  */}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    const next = shared ? 'private' : 'meeting';
                    const { note: saved } = await notesApi.save(note.id, { visibility: next });
                    setNote(saved);
                  }}
                >
                  {shared ? <LockIcon /> : <ShareIcon />}
                  {shared ? 'Make private' : 'Share with the meeting'}
                </Button>

                <Button
                  variant="danger"
                  size="sm"
                  onClick={async () => {
                    if (!window.confirm('Delete this note? This cannot be undone.')) return;
                    await notesApi.remove(note.id);
                    router.push('/notes');
                  }}
                >
                  <TrashIcon />
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <p className="note-page__vis">
          {shared
            ? 'Shared — anyone who was in this meeting can read it. Only you can edit it.'
            : 'Private — only you can see this note.'}
        </p>

        <Alert kind="error">{saveError}</Alert>

        {note.canEdit ? (
          <NoteEditor
            key={note.id}
            note={note}
            people={note.people ?? []}
            onChange={edit}
            autoFocus={!note.title}
          />
        ) : (
          <>
            <h1 className="note__title note__title--read">{note.title || 'Untitled note'}</h1>
            <NoteBody blocks={note.blocks} />
          </>
        )}
      </section>

      <div className="row" style={{ gap: '0.5rem' }}>
        <Button
          variant="ghost"
          onClick={async () => { await flushNow(); router.push('/notes'); }}
        >
          Back to notes
        </Button>
      </div>
    </div>
  );
}
