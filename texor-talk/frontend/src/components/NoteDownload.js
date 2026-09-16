'use client';

import { useEffect, useRef, useState } from 'react';
import { toDocx, toHtml, toMarkdown, toPdf, toPlainText, fileName } from '@/lib/note-export';

/**
 * Saving a note as a file.
 *
 * Everything is produced in the browser from the note already on screen — no
 * request, no server round trip, nothing queued. A note is the most private
 * thing in this product, and "download" should not mean "upload first".
 *
 * The formats live in `lib/note-export.js`, which knows nothing about the DOM
 * and is tested on its own. This file is only the button and the save.
 */

const FORMATS = [
  {
    id: 'docx',
    label: 'Word',
    hint: '.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    build: (note) => toDocx(note),
  },
  { id: 'pdf', label: 'PDF', hint: '.pdf', type: 'application/pdf', build: (note) => toPdf(note) },
  { id: 'md', label: 'Markdown', hint: '.md', type: 'text/markdown', build: (note) => toMarkdown(note) },
  { id: 'html', label: 'Web page', hint: '.html', type: 'text/html', build: (note) => toHtml(note) },
  { id: 'txt', label: 'Plain text', hint: '.txt', type: 'text/plain', build: (note) => toPlainText(note) },
];

function save(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');

  link.href = url;
  link.download = name;
  // Firefox only follows a click on a link that is in the document.
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Not immediately: revoking while the download is still starting cancels it
  // in some browsers, and the object is a few kilobytes.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function NoteDownload({ note, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState('');
  const wrap = useRef(null);

  // Clicking anywhere else, or pressing Escape, puts the menu away — the two
  // things every menu is expected to do and the two that are easy to forget.
  useEffect(() => {
    if (!open) return undefined;

    const away = (event) => { if (!wrap.current?.contains(event.target)) setOpen(false); };
    const key = (event) => { if (event.key === 'Escape') setOpen(false); };

    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const run = (format) => {
    setOpen(false);
    setFailed('');

    try {
      save(format.build(note), fileName(note?.title, format.id), format.type);
    } catch (error) {
      // A download that silently does nothing is the worst outcome here: the
      // user has no way to tell it from a slow one.
      setFailed(`Could not build the ${format.label} file.`);
      if (typeof console !== 'undefined') console.error(error);
    }
  };

  return (
    <div className="dl" ref={wrap}>
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
      >
        Download
        <span className="dl__caret" aria-hidden="true" />
      </button>

      {open ? (
        <div className="dl__menu" role="menu">
          {FORMATS.map((format) => (
            <button
              key={format.id}
              type="button"
              role="menuitem"
              className="dl__item"
              onClick={() => run(format)}
            >
              <span>{format.label}</span>
              <span className="dl__hint">{format.hint}</span>
            </button>
          ))}
        </div>
      ) : null}

      {failed ? <span className="dl__failed" role="alert">{failed}</span> : null}
    </div>
  );
}

export default NoteDownload;
