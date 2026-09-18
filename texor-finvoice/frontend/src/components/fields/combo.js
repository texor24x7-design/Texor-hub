'use client';

/**
 * Shared mechanics for the app's dropdowns: a list pinned to an input and
 * rendered in a portal.
 *
 * The portal is not decoration. Inside a document's items table the list would
 * otherwise be trapped: that table scrolls sideways, and a box with
 * `overflow-x: auto` clips vertically too, which turned the suggestions into a
 * tiny scrollable sliver.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** `watch` re-places the list whenever its contents change size. */
export function useCombo(watch) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState(null);
  const wrap = useRef(null);
  const list = useRef(null);

  const place = useCallback(() => {
    const input = wrap.current?.querySelector('input');
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const height = Math.min(320, Math.max(below - 16, 160));
    const flip = below < 200 && rect.top > below;
    setBox({
      left: Math.min(rect.left, window.innerWidth - Math.max(rect.width, 260) - 8),
      width: Math.max(rect.width, 260),
      top: flip ? undefined : rect.bottom + 4,
      bottom: flip ? window.innerHeight - rect.top + 4 : undefined,
      maxHeight: flip ? Math.min(320, rect.top - 16) : height,
    });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place, watch]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrap.current?.contains(e.target) && !list.current?.contains(e.target)) setOpen(false);
    };
    const onMove = () => place();
    document.addEventListener('mousedown', onDown);
    // `true` so the ancestors that actually scroll (the items table, the page) are heard.
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, place]);

  return { open, setOpen, box, wrap, list, place };
}

export function ComboList({ box, listRef, children }) {
  if (!box) return null;
  return createPortal(
    <div
      className="combo-list"
      role="listbox"
      ref={listRef}
      style={{ position: 'fixed', left: box.left, width: box.width, top: box.top, bottom: box.bottom, maxHeight: box.maxHeight, right: 'auto' }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Moves `active` with the arrow keys over a list of `count` rows. */
export function comboKeys({ open, setOpen, count, active, setActive, onPick, onClose }) {
  return (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(Math.min(active + 1, count - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
    if (e.key === 'Enter' && open) { e.preventDefault(); onPick(active); }
    if (e.key === 'Escape') { setOpen(false); onClose?.(); }
  };
}
