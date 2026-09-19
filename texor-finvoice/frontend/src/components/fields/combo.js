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

/**
 * `watch` re-places the list whenever its contents change size.
 *
 * `anchor` is what the panel hangs off: the combobox's `input`, or `'self'` for
 * a menu, whose wrapper is the trigger. `stretch` matches the panel to the
 * anchor's width, which suits an input and not a 28px icon button.
 */
export function useCombo(watch, { anchor = 'input', align = 'left', minWidth = 260, stretch = true } = {}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState(null);
  const wrap = useRef(null);
  const list = useRef(null);

  const place = useCallback(() => {
    const el = anchor === 'self' ? wrap.current : wrap.current?.querySelector(anchor);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const height = Math.min(320, Math.max(below - 16, 160));
    // Not enough room below, and more above: open upwards instead.
    const flip = below < 200 && rect.top > below;
    const width = stretch ? Math.max(rect.width, minWidth) : undefined;
    setBox({
      ...(align === 'right'
        ? { right: Math.max(window.innerWidth - rect.right, 8) }
        : { left: Math.min(rect.left, window.innerWidth - (width ?? minWidth) - 8) }),
      width,
      top: flip ? undefined : rect.bottom + 4,
      bottom: flip ? window.innerHeight - rect.top + 4 : undefined,
      maxHeight: flip ? Math.min(320, rect.top - 16) : height,
    });
  }, [anchor, align, minWidth, stretch]);

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

export function ComboList({ box, listRef, className = 'combo-list', role = 'listbox', children, ...rest }) {
  if (!box) return null;
  return createPortal(
    <div
      className={className}
      role={role}
      ref={listRef}
      // The unset side must be `auto`, or the stylesheet's `left: 0; right: 0`
      // would stretch the panel across the viewport.
      style={{
        position: 'fixed',
        left: box.left ?? 'auto',
        right: box.right ?? 'auto',
        width: box.width,
        top: box.top,
        bottom: box.bottom,
        maxHeight: box.maxHeight,
      }}
      {...rest}
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
