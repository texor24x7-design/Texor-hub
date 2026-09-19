'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { ActivityPanel } from '@/components/ActivityPanel';
import { ColourPicker } from '@/components/ColourPicker';
import { LabelPicker } from '@/components/LabelPicker';
import { NoteDownload } from '@/components/NoteDownload';
import { NoteEditor, NoteBody } from '@/components/NoteEditor';
import { ShareDialog } from '@/components/ShareDialog';
import { Alert, Button, Loading } from '@/components/ui';
import { ArchiveIcon, PeopleIcon, PinIcon, RestoreIcon, TrashIcon } from '@/components/icons';
import { useAutosave } from '@/lib/use-autosave';
import { labels as labelApi, notes as noteApi } from '@/lib/api';

/** How often an open note asks whether somebody else has changed it. */
const REFRESH_MS = 8000;

export default function NotePage({ params }) {
  const { id } = use(params);
  return <AppShell>{(user) => <NoteView id={id} user={user} />}</AppShell>;
}

function NoteView({ id, user }) {
  const router = useRouter();

  const [note, setNote] = useState(null);
  const [labels, setLabels] = useState([]);
  const [draft, setDraft] = useState(null);
  const [activity, setActivity] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null);

  /**
   * Bumped only when the document on screen is replaced from outside — the
   * first load, somebody else's edit arriving, "show theirs", a restore.
   *
   * The editor is keyed on this and not on the note's version, because every
   * one of this person's own autosaves moves the version too: keyed on that,
   * the editor was torn down and rebuilt after each save, taking the caret and
   * the focus with it mid-sentence.
   */
  const [revision, setRevision] = useState(0);

  /**
   * The version this editor is working against.
   *
   * Held in a ref rather than state because the saver closes over it: a version
   * read from state would be the one that existed when the saver was built, and
   * every save after the first would be refused as stale.
   */
  const version = useRef(1);

  const load = useCallback(async () => {
    const [{ note: found }, { labels: all }] = await Promise.all([noteApi.get(id), labelApi.list()]);
    version.current = found.version;
    setNote(found);
    setLabels(all);
    return found;
  }, [id]);

  useEffect(() => {
    load().then(() => setRevision((n) => n + 1)).catch((loadError) => setError(loadError.message));
  }, [load]);

  const save = useCallback(async (next) => {
    try {
      const { note: saved } = await noteApi.save(id, { ...next, version: version.current });
      version.current = saved.version;
      setNote((current) => ({ ...current, ...saved }));
      setConflict(null);
    } catch (saveError) {
      /**
       * Somebody else saved while this person was typing.
       *
       * Their words are still on screen and still in the draft — what is
       * refused is overwriting. The other version is offered beside it rather
       * than applied, because picking which one survives is a decision, not
       * something a timer should make.
       */
      if (saveError.code === 'stale_version') {
        setConflict(saveError.details ?? null);
        return;
      }
      throw saveError;
    }
  }, [id]);

  const { state, flushNow, queue } = useAutosave(save);

  // While a note is open and shared, somebody else may be in it. Polling rather
  // than a socket, for the reasons Texor Talk's lists give: one connection per
  // person staring at a note is a lot of sockets for a page that changes rarely.
  useEffect(() => {
    if (!note?.shared || conflict) return undefined;

    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const { note: fresh } = await noteApi.get(id);
        // Only when nothing local is waiting to be sent, or a refresh would
        // throw away what is being typed.
        if (fresh.version !== version.current && state !== 'dirty' && state !== 'saving') {
          version.current = fresh.version;
          setNote(fresh);
          setDraft(null);
          setRevision((n) => n + 1);
        }
      } catch {
        // A blink of network is not worth saying anything about.
      }
    }, REFRESH_MS);

    return () => clearInterval(timer);
  }, [id, note?.shared, conflict, state]);

  useEffect(() => {
    if (!note) return;
    noteApi.activity(id).then(({ activity: rows }) => setActivity(rows)).catch(() => setActivity([]));
  }, [id, note?.version, note]);

  if (error) {
    return (
      <div className="empty">
        <h2>That note is not here</h2>
        <p>{error}</p>
        <Button onClick={() => router.push('/notes')}>Back to your notes</Button>
      </div>
    );
  }

  if (!note) return <Loading label="Opening the note" />;

  const shown = { ...note, ...(draft ?? {}) };

  async function patch(changes) {
    try {
      const { note: saved } = await noteApi.save(id, changes);
      version.current = saved.version;
      setNote((current) => ({ ...current, ...saved }));
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  return (
    <div className="board">
      <div className="note-head">
        <Button variant="ghost" size="sm" onClick={async () => { await flushNow(); router.push('/notes'); }}>
          ← Notes
        </Button>

        <span className="note-head__state meta">
          {conflict ? '' : state === 'saving' ? 'Saving…' : state === 'dirty' ? 'Unsaved changes'
            : state === 'error' ? 'Could not save' : state === 'saved' ? 'Saved' : ''}
        </span>

        <span className="note-head__spacer" />

        {note.canEdit ? (
          <>
            <button
              type="button"
              className={`card__action ${note.pinned ? 'card__action--on' : ''}`}
              aria-label={note.pinned ? 'Unpin' : 'Pin'}
              onClick={() => patch({ pinned: !note.pinned })}
            >
              <PinIcon />
            </button>
            <button
              type="button"
              className="card__action"
              aria-label={note.archived ? 'Take out of the archive' : 'Archive'}
              onClick={() => patch({ archived: !note.archived })}
            >
              <ArchiveIcon />
            </button>
          </>
        ) : null}

        <NoteDownload note={shown} />

        {note.canShare ? (
          <Button variant="secondary" size="sm" onClick={() => setSharing(true)}>
            <PeopleIcon /> Share
          </Button>
        ) : null}

        {note.role === 'owner' ? (
          note.deletedAt ? (
            <>
              <Button size="sm" onClick={async () => { await noteApi.restore(id); await load(); setRevision((n) => n + 1); }}>
                <RestoreIcon /> Put back
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  if (!window.confirm('Delete this note for good? This cannot be undone.')) return;
                  await noteApi.purge(id);
                  router.push('/trash');
                }}
              >
                Delete for good
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => { await noteApi.remove(id); router.push('/notes'); }}
            >
              <TrashIcon /> Trash
            </Button>
          )
        ) : null}
      </div>

      {note.deletedAt ? (
        <Alert kind="info">This note is in the trash. Put it back to edit it again.</Alert>
      ) : null}

      {conflict ? (
        <Alert kind="error">
          {conflict.lastEditedBy?.name ?? 'Somebody'} saved this note while you were typing. Your
          version is still on screen.{' '}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={async () => { setConflict(null); setDraft(null); await load(); setRevision((n) => n + 1); }}
          >
            Show theirs
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={async () => {
              // Take the newer version's number and save over it: a deliberate
              // choice by the person who can see both.
              version.current = conflict.version;
              setConflict(null);
              queue(draft ?? { title: note.title, blocks: note.blocks });
            }}
          >
            Keep mine
          </button>
        </Alert>
      ) : null}

      <div className={`note-shell ${note.canEdit ? 'note-shell--with-aside' : ''}`}>
        <div className="note-page">
          {note.canEdit && !note.deletedAt ? (
            <NoteEditor
              key={`${id}-${revision}`}
              note={shown}
              people={(note.shares ?? []).map((share) => ({
                texorId: share.email,
                name: share.name || share.email,
              }))}
              onChange={(next) => {
                setDraft(next);
                queue(next);
              }}
            />
          ) : (
            <>
              <h1 className="note__title">{shown.title || 'Untitled note'}</h1>
              <NoteBody blocks={shown.blocks} />
            </>
          )}
        </div>

        {note.canEdit ? (
          <aside className="aside">
            <section className="aside__panel">
              <h2>Colour</h2>
              <ColourPicker value={note.colour} onPick={(colour) => patch({ colour })} />
            </section>

            <section className="aside__panel">
              <h2>Labels</h2>
              <LabelPicker
                labels={labels}
                selected={note.labels ?? []}
                onToggle={async (labelId) => {
                  const next = note.labels?.includes(labelId)
                    ? note.labels.filter((row) => row !== labelId)
                    : [...(note.labels ?? []), labelId];
                  const { note: saved } = await noteApi.setLabels(id, next);
                  setNote((current) => ({ ...current, ...saved }));
                }}
              />
            </section>

            <section className="aside__panel">
              <h2>Activity</h2>
              <ActivityPanel activity={activity} />
            </section>
          </aside>
        ) : null}
      </div>

      {sharing ? (
        <ShareDialog
          title={note.title || 'this note'}
          shares={note.shares ?? []}
          canShare={note.canShare}
          onClose={() => setSharing(false)}
          onShare={async (body) => { await noteApi.share(id, body); await load(); }}
          onUnshare={async (email) => { await noteApi.unshare(id, email); await load(); }}
        />
      ) : null}
    </div>
  );
}
