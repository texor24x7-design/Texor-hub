'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  BoldIcon, BulletIcon, CodeIcon, HeadingIcon, HighlightIcon, ItalicIcon, QuoteIcon, TodoIcon,
} from '@/components/icons';
import {
  HIGHLIGHTS,
  caretOffset,
  emptyBlock,
  insertMention,
  matchPeople,
  mentionQuery,
  rangeHasMark,
  readBlock,
  segments,
  selectionRange,
  setSelection,
  spliceText,
  toggleMark,
  writeBlock,
} from '@/lib/notes-doc';

/**
 * The note editor.
 *
 * ── React and contentEditable ──
 *
 * These two disagree about who owns the DOM, and the usual result is a caret
 * that jumps to the start of the line on every keystroke. The rule here is that
 * **React never renders a block's content**: each block is an empty
 * `contentEditable` div, and its children are written imperatively by
 * `writeBlock`.
 *
 * That write happens only when the model changed from somewhere other than
 * typing — loading, formatting, inserting a mention — which each bump the
 * block's `rev`. Plain typing updates the model and leaves `rev` alone, so the
 * DOM the browser just edited is never torn down underneath the caret. It also
 * leaves input method composition alone, which a rewrite-per-keystroke editor
 * breaks for anybody typing a language that needs it.
 */

let sequence = 0;
const freshId = () => {
  sequence += 1;
  return `b${sequence}`;
};

/** Model blocks carry client-only bookkeeping; the server never sees it. */
const hydrate = (blocks) =>
  (blocks?.length ? blocks : [emptyBlock()]).map((block) => ({
    ...block,
    marks: block.marks ?? [],
    id: freshId(),
    rev: 0,
  }));

const strip = (blocks) =>
  blocks.map(({ id, rev, caret, ...block }) => block);

const BLOCK_CONTROLS = [
  ['heading', 'Heading', <HeadingIcon key="h" />],
  ['bullet', 'Bullet point', <BulletIcon key="b" />],
  ['todo', 'Action item', <TodoIcon key="t" />],
  ['quote', 'Something someone said', <QuoteIcon key="q" />],
];

export function NoteEditor({
  note,
  people = [],
  onChange,
  autoFocus = false,
  compact = false,
}) {
  const [title, setTitle] = useState(note?.title ?? '');
  const [blocks, setBlocks] = useState(() => hydrate(note?.blocks));
  const [focused, setFocused] = useState(null);

  // Where the floating format bar should sit, and what it would act on.
  const [bar, setBar] = useState(null);
  // The people picker opened by typing `@`.
  const [picker, setPicker] = useState(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  // Which quote block is choosing a speaker.
  const [speakerFor, setSpeakerFor] = useState(null);

  const elements = useRef(new Map());
  const root = useRef(null);

  /**
   * Report upward on every change, and let the page own saving.
   *
   * The editor deliberately knows nothing about the network: it is used inside
   * a call, on a full page, and in tests, and only one of those has a note id.
   *
   * An effect rather than a call inside each state updater: React may run an
   * updater twice, and a function that reaches outside its own state has to be
   * safe to run twice or not be there at all.
   */
  /**
   * Reported when the document changes — and only then.
   *
   * `onChange` is read through a ref rather than listed as a dependency. It is
   * an inline arrow at almost any call site, so as a dependency it re-announced
   * the unchanged document on every render of the parent; a parent that stores
   * the draft in state then re-rendered, made a new arrow, and the two chased
   * each other until React gave up with "Maximum update depth exceeded".
   */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const settled = useRef(false);
  useEffect(() => {
    if (!settled.current) { settled.current = true; return; }
    onChangeRef.current?.({ title, blocks: strip(blocks) });
  }, [title, blocks]);

  /** Replace one block. `rerender` is what makes the DOM catch up. */
  const putBlock = useCallback((id, produce, { rerender = false, caret } = {}) => {
    setBlocks((current) => {
      const next = current.map((block) => {
        if (block.id !== id) return block;
        const produced = produce(block);
        return {
          ...produced,
          id,
          rev: rerender ? block.rev + 1 : block.rev,
          caret: rerender ? caret : undefined,
        };
      });
      return next;
    });
  }, []);

  const people_ = useMemo(() => people ?? [], [people]);

  /* ── the floating format bar ────────────────────────────────────────────── */

  const refreshBar = useCallback(() => {
    const id = focused;
    const el = id ? elements.current.get(id) : null;
    if (!el) return setBar(null);

    const range = selectionRange(el);
    if (!range || range.to <= range.from) return setBar(null);

    const rect = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return setBar(null);

    const block = blocks.find((candidate) => candidate.id === id);
    return setBar({
      id,
      from: range.from,
      to: range.to,
      top: rect.top,
      left: rect.left + rect.width / 2,
      active: {
        bold: rangeHasMark(block, range.from, range.to, 'bold'),
        italic: rangeHasMark(block, range.from, range.to, 'italic'),
        code: rangeHasMark(block, range.from, range.to, 'code'),
        highlight: HIGHLIGHTS.find((swatch) =>
          rangeHasMark(block, range.from, range.to, 'highlight', swatch.id))?.id ?? null,
      },
    });
  }, [focused, blocks]);

  useEffect(() => {
    const onSelect = () => {
      // The picker owns the caret while it is open; a format bar over the top
      // of it would be two popovers fighting for the same few pixels.
      if (picker) return;
      refreshBar();
    };
    document.addEventListener('selectionchange', onSelect);
    return () => document.removeEventListener('selectionchange', onSelect);
  }, [refreshBar, picker]);

  const applyMark = useCallback((mark) => {
    if (!bar) return;
    const el = elements.current.get(bar.id);
    if (!el) return;

    putBlock(bar.id, (block) => toggleMark(block, bar.from, bar.to, mark), {
      rerender: true,
      caret: { from: bar.from, to: bar.to },
    });
  }, [bar, putBlock]);

  /* ── mentions ───────────────────────────────────────────────────────────── */

  const candidates = useMemo(
    () => (picker ? matchPeople(people_, picker.query).slice(0, 6) : []),
    [picker, people_],
  );

  useEffect(() => { setPickerIndex(0); }, [picker?.query]);

  const choosePerson = useCallback((person) => {
    if (!picker || !person) return;

    const caretAt = picker.from + `@${person.name} `.length;
    putBlock(picker.id, (block) => insertMention(block, picker.from, picker.to, person), {
      rerender: true,
      caret: { from: caretAt, to: caretAt },
    });
    setPicker(null);
  }, [picker, putBlock]);

  /* ── typing ─────────────────────────────────────────────────────────────── */

  const onInput = useCallback((block) => {
    const el = elements.current.get(block.id);
    if (!el) return;

    const read = readBlock(el, block.type);
    const caret = caretOffset(el);

    // No rerender: the browser's DOM is already correct and is what we just
    // read. Writing it back would move the caret to the end of the line.
    putBlock(block.id, (current) => ({ ...current, ...read, type: current.type }));

    const query = caret == null ? null : mentionQuery(read.text, caret);
    if (!query) return setPicker(null);

    const rect = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect();
    return setPicker({
      id: block.id,
      ...query,
      top: (rect?.bottom ?? 0) + 6,
      left: rect?.left ?? 0,
    });
  }, [putBlock]);

  const addBlockAfter = useCallback((id, type = 'paragraph') => {
    const created = { ...emptyBlock(type), id: freshId(), rev: 1 };

    /**
     * Drawn and focused before this keydown handler returns.
     *
     * It used to be drawn on React's usual schedule and focused a frame later,
     * and anything typed in that gap went into the block the caret had just
     * left: "Enter, Second line" produced "…planS" and "econd line". The block
     * is committed synchronously instead, so the very next keystroke already
     * has somewhere to go.
     */
    flushSync(() => {
      setBlocks((current) => {
        const at = current.findIndex((block) => block.id === id);
        const next = [...current];
        next.splice(at + 1, 0, created);
        return next;
      });
    });

    elements.current.get(created.id)?.focus();
    return created.id;
  }, []);

  const removeBlock = useCallback((id) => {
    let previous = null;

    // Synchronously, for the same reason as `addBlockAfter`: the block that had
    // the caret is about to stop existing, and a keystroke arriving before the
    // caret has moved would go nowhere at all.
    flushSync(() => {
      setBlocks((current) => {
        if (current.length === 1) return current;

        const at = current.findIndex((block) => block.id === id);
        previous = current[at - 1] ?? null;
        return current.filter((block) => block.id !== id);
      });
    });

    if (previous) {
      const el = elements.current.get(previous.id);
      el?.focus();
      setSelection(el, previous.text.length);
    }
  }, []);

  const onKeyDown = useCallback((event, block) => {
    /* The picker takes the arrow keys and Enter while it is open. */
    if (picker && picker.id === block.id) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        return setPickerIndex((index) => (index + 1) % Math.max(candidates.length, 1));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        return setPickerIndex((index) => (index - 1 + candidates.length) % Math.max(candidates.length, 1));
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && candidates.length > 0) {
        event.preventDefault();
        return choosePerson(candidates[pickerIndex]);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        return setPicker(null);
      }
    }

    const el = elements.current.get(block.id);

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      /**
       * Enter on an empty list item ends the list rather than making another
       * one, which is what every editor people already use does — and the only
       * way out of a bullet list that does not involve reaching for the mouse.
       */
      if (block.text === '' && block.type !== 'paragraph') {
        return putBlock(block.id, (current) => ({ ...current, type: 'paragraph' }), { rerender: true });
      }
      // A new bullet follows a bullet; a new anything-else is a paragraph.
      const carry = block.type === 'bullet' || block.type === 'todo' ? block.type : 'paragraph';
      return addBlockAfter(block.id, carry);
    }

    if (event.key === 'Backspace') {
      const caret = el ? caretOffset(el) : null;
      if (caret === 0 && selectionRange(el)?.to === 0) {
        // Leaving a list is the first thing Backspace at the start should do;
        // deleting the block is the second.
        if (block.type !== 'paragraph') {
          event.preventDefault();
          return putBlock(block.id, (current) => ({ ...current, type: 'paragraph' }), { rerender: true });
        }
        if (block.text === '') {
          event.preventDefault();
          return removeBlock(block.id);
        }
      }
    }

    // The shortcuts people try without being told they exist.
    if (event.metaKey || event.ctrlKey) {
      const range = selectionRange(el);
      const shortcut = { b: { type: 'bold' }, i: { type: 'italic' }, e: { type: 'code' } }[event.key.toLowerCase()];
      const highlight = event.shiftKey && event.key.toLowerCase() === 'h';

      if ((shortcut || highlight) && range && range.to > range.from) {
        event.preventDefault();
        const mark = highlight ? { type: 'highlight', color: 'yellow' } : shortcut;
        return putBlock(block.id, (current) => toggleMark(current, range.from, range.to, mark), {
          rerender: true,
          caret: range,
        });
      }
    }

    return undefined;
  }, [picker, candidates, pickerIndex, choosePerson, putBlock, addBlockAfter, removeBlock]);

  /**
   * Paste arrives as plain text, always.
   *
   * Pasting from a web page otherwise drops that page's markup into the block,
   * and while `readBlock` would strip it on the way out, the user would watch
   * their note briefly take on somebody else's fonts and colours.
   */
  const onPaste = useCallback((event, block) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;

    const el = elements.current.get(block.id);
    const range = selectionRange(el) ?? { from: block.text.length, to: block.text.length };
    const lines = text.split(/\r?\n/);

    // A multi-line paste becomes multiple blocks, because one block is one line.
    const [head, ...rest] = lines;
    const caretAt = range.from + head.length;

    setBlocks((current) => {
      const at = current.findIndex((candidate) => candidate.id === block.id);
      const edited = {
        ...spliceText(current[at], range.from, range.to, head),
        id: block.id,
        rev: current[at].rev + 1,
        caret: rest.length === 0 ? { from: caretAt, to: caretAt } : undefined,
      };

      const extra = rest.map((line) => ({
        ...emptyBlock(block.type === 'bullet' || block.type === 'todo' ? block.type : 'paragraph'),
        text: line,
        id: freshId(),
        rev: 1,
      }));

      const next = [...current];
      next.splice(at, 1, edited, ...extra);
      return next;
    });
  }, []);

  /* ── the document ───────────────────────────────────────────────────────── */

  return (
    <div className={`note ${compact ? 'note--compact' : ''}`} ref={root}>
      <input
        className="note__title"
        value={title}
        placeholder="Untitled note"
        aria-label="Note title"
        autoFocus={autoFocus}
        onChange={(event) => setTitle(event.target.value)}
      />

      <div className="note__blocks">
        {blocks.map((block) => (
          <BlockRow
            key={block.id}
            block={block}
            people={people_}
            compact={compact}
            register={(el) => {
              if (el) elements.current.set(block.id, el);
              else elements.current.delete(block.id);
            }}
            onInput={() => onInput(block)}
            onKeyDown={(event) => onKeyDown(event, block)}
            onPaste={(event) => onPaste(event, block)}
            onFocus={() => setFocused(block.id)}
            onBlur={() => { setPicker(null); }}
            onToggleDone={() =>
              putBlock(block.id, (current) => ({ ...current, done: !current.done }))}
            onSetType={(type) =>
              putBlock(block.id, (current) => ({ ...current, type }), { rerender: true })}
            onPickSpeaker={() => setSpeakerFor(block.id)}
          />
        ))}
      </div>

      {/* Block-level controls act on whatever is focused, and stay out of the
          way of the text until they are needed. */}
      <div className="note__rail" onMouseDown={(event) => event.preventDefault()}>
        {BLOCK_CONTROLS.map(([type, label, icon]) => {
          const current = blocks.find((block) => block.id === focused);
          const on = current?.type === type;
          return (
            <button
              key={type}
              type="button"
              className={`note__rail-btn ${on ? 'note__rail-btn--on' : ''}`}
              title={label}
              aria-label={label}
              aria-pressed={on}
              disabled={!focused}
              onClick={() => {
                if (!focused) return;
                putBlock(focused, (block) => ({ ...block, type: on ? 'paragraph' : type }), {
                  rerender: true,
                });
                if (type === 'quote' && !on) setSpeakerFor(focused);
              }}
            >
              {icon}
            </button>
          );
        })}
      </div>

      {bar && !picker ? (
        <FormatBar bar={bar} onMark={applyMark} />
      ) : null}

      {picker ? (
        <MentionPicker
          picker={picker}
          candidates={candidates}
          index={pickerIndex}
          onPick={choosePerson}
          onHover={setPickerIndex}
        />
      ) : null}

      {speakerFor ? (
        <SpeakerPicker
          people={people_}
          onClose={() => setSpeakerFor(null)}
          onPick={(person) => {
            putBlock(speakerFor, (block) => ({
              ...block,
              type: 'quote',
              speakerTexorId: person?.texorId,
              speakerName: person?.name,
              at: block.at ?? new Date().toISOString(),
            }));
            setSpeakerFor(null);
            requestAnimationFrame(() => elements.current.get(speakerFor)?.focus());
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * One block.
 *
 * The `contentEditable` div has no React children on purpose — see the note at
 * the top of this file. Everything React draws around it (the bullet, the
 * checkbox, the speaker chip) sits outside the editable area.
 */
function BlockRow({
  block, people, compact, register, onInput, onKeyDown, onPaste, onFocus, onBlur,
  onToggleDone, onSetType, onPickSpeaker,
}) {
  const ref = useRef(null);

  // Unregister on unmount only; the element itself is captured below by the
  // callback ref, which React calls exactly when it changes.
  useEffect(() => () => register(null), []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Only on a programmatic change. `rev` is the whole mechanism.
  useEffect(() => {
    if (!ref.current) return;
    writeBlock(ref.current, block);
    if (block.caret) {
      ref.current.focus();
      setSelection(ref.current, block.caret.from, block.caret.to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.rev]);

  const placeholder = {
    heading: 'Section',
    bullet: 'List item',
    todo: 'Something to do',
    quote: 'What they said',
    paragraph: compact ? 'Take a note…' : 'Start typing, or press @ to tag someone',
  }[block.type];

  const speaker = block.speakerName
    ? people.find((person) => person.texorId === block.speakerTexorId) ?? { name: block.speakerName }
    : null;

  return (
    <div className={`note__block note__block--${block.type} ${block.done ? 'note__block--done' : ''}`}>
      {block.type === 'bullet' ? <span className="note__bullet" aria-hidden="true" /> : null}

      {block.type === 'todo' ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={Boolean(block.done)}
          aria-label="Done"
          className={`note__check ${block.done ? 'note__check--on' : ''}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggleDone}
        />
      ) : null}

      <div className="note__block-main">
        {block.type === 'quote' ? (
          <button
            type="button"
            className="note__speaker"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onPickSpeaker}
          >
            {speaker ? (
              <>
                <span className="note__speaker-dot" aria-hidden="true">
                  {(speaker.name ?? '?').trim().charAt(0).toUpperCase()}
                </span>
                {speaker.name}
              </>
            ) : 'Who said this?'}
            {block.at ? (
              <span className="note__speaker-at">
                {new Date(block.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
          </button>
        ) : null}

        <div
          ref={(el) => { ref.current = el; register(el); }}
          className="note__text"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="false"
          aria-label={placeholder}
          data-placeholder={placeholder}
          spellCheck
          onInput={onInput}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={onFocus}
          onBlur={onBlur}
          onDoubleClick={() => { if (block.type === 'quote' && !block.speakerName) onSetType('quote'); }}
        />
      </div>
    </div>
  );
}

/**
 * The bar that appears over a selection.
 *
 * `onMouseDown` is prevented on the whole thing: without it, pressing a button
 * blurs the editor, the selection collapses, and the command has nothing left
 * to act on — a bug that looks like the button simply not working.
 */
function FormatBar({ bar, onMark }) {
  return (
    <div
      className="note__bar"
      style={{ top: `${bar.top}px`, left: `${bar.left}px` }}
      role="toolbar"
      aria-label="Formatting"
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button" aria-label="Bold" aria-pressed={bar.active.bold}
        className={`note__bar-btn ${bar.active.bold ? 'note__bar-btn--on' : ''}`}
        onClick={() => onMark({ type: 'bold' })}
      ><BoldIcon /></button>
      <button
        type="button" aria-label="Italic" aria-pressed={bar.active.italic}
        className={`note__bar-btn ${bar.active.italic ? 'note__bar-btn--on' : ''}`}
        onClick={() => onMark({ type: 'italic' })}
      ><ItalicIcon /></button>
      <button
        type="button" aria-label="Code" aria-pressed={bar.active.code}
        className={`note__bar-btn ${bar.active.code ? 'note__bar-btn--on' : ''}`}
        onClick={() => onMark({ type: 'code' })}
      ><CodeIcon /></button>

      <span className="note__bar-sep" aria-hidden="true" />

      <span className="note__bar-pen" aria-hidden="true"><HighlightIcon /></span>
      {HIGHLIGHTS.map((swatch) => (
        <button
          key={swatch.id}
          type="button"
          aria-label={`Highlight ${swatch.label}`}
          aria-pressed={bar.active.highlight === swatch.id}
          className={`note__swatch note__swatch--${swatch.id} ${
            bar.active.highlight === swatch.id ? 'note__swatch--on' : ''
          }`}
          onClick={() => onMark({ type: 'highlight', color: swatch.id })}
        />
      ))}
    </div>
  );
}

/** The `@` picker. Positioned under the caret, keyboard-first. */
function MentionPicker({ picker, candidates, index, onPick, onHover }) {
  if (candidates.length === 0) {
    return (
      <div className="note__mentions" style={{ top: `${picker.top}px`, left: `${picker.left}px` }}>
        <p className="note__mentions-empty">
          Nobody here matches “{picker.query}”.
        </p>
      </div>
    );
  }

  return (
    <div
      className="note__mentions"
      style={{ top: `${picker.top}px`, left: `${picker.left}px` }}
      role="listbox"
      aria-label="Tag someone"
    >
      {candidates.map((person, at) => (
        <button
          key={person.texorId}
          type="button"
          role="option"
          aria-selected={at === index}
          className={`note__mention-row ${at === index ? 'note__mention-row--on' : ''}`}
          onMouseEnter={() => onHover(at)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(person)}
        >
          {person.picture
            ? <img src={person.picture} alt="" className="note__mention-face" />
            : (
              <span className="note__mention-face note__mention-face--letter">
                {(person.name ?? '?').trim().charAt(0).toUpperCase()}
              </span>
            )}
          <span className="note__mention-name">{person.name}</span>
          {person.attended ? null : <span className="note__mention-tag">invited</span>}
        </button>
      ))}
    </div>
  );
}

/** Who said it. Opened by the quote control, and by clicking the chip. */
function SpeakerPicker({ people, onPick, onClose }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog__scrim" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="dialog dialog--plain" role="dialog" aria-modal="true" aria-label="Who said this?">
        <div className="dialog__body">
          <h3 style={{ marginBottom: '0.75rem' }}>Who said this?</h3>

          {people.length === 0 ? (
            <p className="meta">Nobody to attribute this to yet.</p>
          ) : (
            <div className="note__speaker-list">
              {people.map((person) => (
                <button
                  key={person.texorId}
                  type="button"
                  className="note__mention-row"
                  onClick={() => onPick(person)}
                >
                  {person.picture
                    ? <img src={person.picture} alt="" className="note__mention-face" />
                    : (
                      <span className="note__mention-face note__mention-face--letter">
                        {(person.name ?? '?').trim().charAt(0).toUpperCase()}
                      </span>
                    )}
                  <span className="note__mention-name">{person.name}</span>
                </button>
              ))}
            </div>
          )}

          <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: '0.75rem' }} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A note, rendered for reading.
 *
 * Built from the same `segments` the editor writes its DOM from, so a shared
 * note looks exactly like the one its author is looking at. React elements
 * rather than markup — there is no `dangerouslySetInnerHTML` anywhere in this
 * feature, and there is no point in the pipeline where a note becomes HTML that
 * somebody could have written.
 */
export function NoteBody({ blocks, onToggle }) {
  if (!blocks?.length) return <p className="meta">This note is empty.</p>;

  return (
    <div className="note note--read">
      <div className="note__blocks">
        {blocks.map((block, index) => (
          <div
            key={index}
            className={`note__block note__block--${block.type} ${block.done ? 'note__block--done' : ''}`}
          >
            {block.type === 'bullet' ? <span className="note__bullet" aria-hidden="true" /> : null}
            {block.type === 'todo' ? (
              <button
                type="button"
                role="checkbox"
                aria-checked={Boolean(block.done)}
                aria-label="Done"
                disabled={!onToggle}
                className={`note__check ${block.done ? 'note__check--on' : ''}`}
                onClick={() => onToggle?.(index)}
              />
            ) : null}

            <div className="note__block-main">
              {block.type === 'quote' && block.speakerName ? (
                <span className="note__speaker note__speaker--read">
                  <span className="note__speaker-dot" aria-hidden="true">
                    {block.speakerName.trim().charAt(0).toUpperCase()}
                  </span>
                  {block.speakerName}
                  {block.at ? (
                    <span className="note__speaker-at">
                      {new Date(block.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  ) : null}
                </span>
              ) : null}

              <div className="note__text">
                {segments(block).map((run, at) => <Run key={at} run={run} />)}
                {block.text === '' ? <br /> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Run({ run }) {
  const mention = run.marks.find((mark) => mark.type === 'mention');
  if (mention) return <span className="note-mention">{run.text}</span>;

  let node = run.text;
  if (run.marks.some((mark) => mark.type === 'code')) node = <code className="note-code">{node}</code>;
  if (run.marks.some((mark) => mark.type === 'italic')) node = <em className="note-italic">{node}</em>;
  if (run.marks.some((mark) => mark.type === 'bold')) node = <strong className="note-bold">{node}</strong>;

  const highlight = run.marks.find((mark) => mark.type === 'highlight');
  if (highlight) {
    node = (
      <mark className={`note-highlight note-highlight--${highlight.color ?? 'yellow'}`}>{node}</mark>
    );
  }

  return <>{node}</>;
}

export default NoteEditor;
