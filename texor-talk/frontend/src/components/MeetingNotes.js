'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronIcon, LockIcon, PlusIcon, ShareIcon } from '@/components/icons';
import { NoteEditor } from '@/components/NoteEditor';
import { notes as notesApi } from '@/lib/api';
import { saveLabel, useAutosave } from '@/lib/use-autosave';

/**
 * Notes, inside the call.
 *
 * Two states and nothing else: a list of this meeting's notes, or one of them
 * open. A panel this narrow cannot afford chrome, and somebody typing in it is
 * half-listening to a conversation — every control that is not the text is
 * competing with the meeting for their attention.
 */
export function MeetingNotes({ code, livePeople = [], onError }) {
  const [rows, setRows] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [note, setNote] = useState(null);
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(false);

  const fail = useCallback((error) => onError?.(error.message ?? String(error)), [onError]);

  /**
   * Who can be tagged: everybody who has been in this meeting, plus whoever is
   * in it right now.
   *
   * The server list is the complete one — it includes the person who spoke and
   * dropped off, which is exactly who you want to attribute a quote to. The
   * live roster is merged over the top so somebody who joined ten seconds ago
   * is taggable without waiting for a refetch.
   */
  const taggable = useMemo(() => {
    const merged = new Map();
    for (const person of people) merged.set(person.texorId, person);

    for (const peer of livePeople) {
      // By id, not by role: `role === 'guest'` is what a meeting calls a
      // colleague who was not formally invited, which is most of an open
      // meeting. A `guest:` id is somebody with no account to tag.
      if (!peer?.texorId || peer.texorId.startsWith('guest:')) continue;
      merged.set(peer.texorId, {
        texorId: peer.texorId,
        name: peer.name ?? merged.get(peer.texorId)?.name ?? 'Someone',
        picture: peer.picture || merged.get(peer.texorId)?.picture || '',
        attended: true,
      });
    }

    return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [people, livePeople]);

  const loadList = useCallback(async () => {
    try {
      const { notes: found } = await notesApi.list({ scope: 'mine', meetingCode: code });
      setRows(found);
    } catch (error) {
      setRows([]);
      fail(error);
    }
  }, [code, fail]);

  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    let cancelled = false;
    notesApi.people(code)
      .then(({ people: found }) => { if (!cancelled) setPeople(found); })
      // Not being able to tag anyone must not stop somebody taking notes.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [code]);

  useEffect(() => {
    if (!openId) return undefined;
    let cancelled = false;

    notesApi.get(openId)
      .then(({ note: found }) => { if (!cancelled) setNote(found); })
      .catch((error) => { if (!cancelled) fail(error); });

    return () => { cancelled = true; };
  }, [openId, fail]);

  const save = useCallback((draft) => notesApi.save(openId, draft), [openId]);
  const { state, queue, flushNow } = useAutosave(save);

  const startNote = useCallback(async () => {
    setBusy(true);
    try {
      const { note: created } = await notesApi.create({ meetingCode: code, blocks: [] });
      setNote(created);
      setOpenId(created.id);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }, [code, fail]);

  const close = useCallback(async () => {
    await flushNow();
    setOpenId(null);
    setNote(null);
    loadList();
  }, [flushNow, loadList]);

  /* ── one note, open ─────────────────────────────────────────────────────── */

  if (openId) {
    return (
      <div className="meet-notes">
        <div className="meet-notes__bar">
          <button type="button" className="meet-notes__back" onClick={close}>
            <ChevronIcon /> All notes
          </button>
          <span className={`meet-notes__state meet-notes__state--${state}`} role="status">
            {saveLabel(state)}
          </span>
        </div>

        {note ? (
          <div className="meet-notes__editor">
            <NoteEditor
              key={note.id}
              note={note}
              people={taggable}
              onChange={queue}
              compact
              autoFocus
            />
          </div>
        ) : (
          <p className="meet-notes__hint">Opening…</p>
        )}
      </div>
    );
  }

  /* ── the list ───────────────────────────────────────────────────────────── */

  return (
    <div className="meet-notes">
      <p className="meet-notes__hint">
        Yours alone unless you share them, and they stay in Notes after the meeting ends.
      </p>

      <button type="button" className="meet-notes__new" onClick={startNote} disabled={busy}>
        <PlusIcon /> {busy ? 'Starting…' : 'New note'}
      </button>

      <div className="meet-notes__list">
        {rows?.map((row) => (
          <button key={row.id} type="button" className="meet-notes__row" onClick={() => setOpenId(row.id)}>
            <span className="meet-notes__row-top">
              <strong>{row.title || 'Untitled note'}</strong>
              {row.visibility === 'meeting' ? <ShareIcon /> : <LockIcon />}
            </span>
            <span className="meet-notes__row-preview">{row.preview || 'Empty'}</span>
          </button>
        ))}

        {rows?.length === 0 ? (
          <p className="meet-notes__empty">
            Nothing yet. Start one and type — tag someone with <code>@</code>, or select text to
            highlight it.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default MeetingNotes;
