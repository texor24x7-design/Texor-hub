'use client';

/**
 * The receipt printing itself.
 *
 * Shown when a document whose design is an 80 mm or 58 mm roll is issued. The
 * paper is the real rendered receipt — the same HTML the preview, the public
 * link and the PDF use — fed out of the slot rather than a picture of one.
 *
 * The feed is a `steps()` animation on purpose: a thermal head advances the
 * roll a line at a time, and a smooth slide reads as a slideshow instead.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, Printer, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { fileUrl } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';

const PX_PER_MM = 96 / 25.4;
const FEED_MS = 2200;

/** '80mm' → 80. Anything else is not a roll and gets no printer. */
export const rollWidthOf = (design) => {
  const size = design?.page?.size ?? '';
  const match = /^(\d+)mm$/.exec(size);
  return match ? Number(match[1]) : null;
};

export function ThermalPrint({ open, onClose, kind, id, design, widthMm = 80, pdfUrl }) {
  const { api } = useWorkspace();
  const [html, setHtml] = useState('');
  const [height, setHeight] = useState(420);
  const [fed, setFed] = useState(false);
  const frame = useRef(null);

  useEffect(() => {
    if (!open) { setFed(false); setHtml(''); return undefined; }
    let cancelled = false;
    api.text(`/documents/${kind}/${id}/html${design ? `?design=${encodeURIComponent(design)}` : ''}`)
      .then((text) => { if (!cancelled) setHtml(text); })
      .catch(() => { if (!cancelled) onClose?.(); });
    return () => { cancelled = true; };
  }, [open, api, kind, id, design, onClose]);

  // The roll only stops once the whole receipt is out, so the feed lasts as
  // long as the paper is long — a one-line receipt should not take as long as
  // a fifty-line one.
  const fit = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (doc?.body) setHeight(Math.max(doc.documentElement.scrollHeight + 6, 200));
  }, []);

  useEffect(() => {
    if (!open || !html) return undefined;
    // Nobody who asked for less motion should wait out an animation they are
    // not being shown.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) { setFed(true); return undefined; }
    const timer = setTimeout(() => setFed(true), FEED_MS + 120);
    return () => clearTimeout(timer);
  }, [open, html]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const paperPx = Math.round(widthMm * PX_PER_MM);

  return (
    <div className="tp" role="dialog" aria-modal="true" aria-label="Printing receipt" onClick={(e) => { if (e.target === e.currentTarget && fed) onClose?.(); }}>
      <button type="button" className="tp-close" aria-label="Close" onClick={onClose}><X size={18} /></button>

      <div className="tp-stage" style={{ '--tp-paper': `${paperPx}px`, '--tp-h': `${height}px`, '--tp-feed': `${FEED_MS}ms` }}>
        <div className={`tp-printer${fed ? '' : ' is-feeding'}`}>
          <div className="tp-lid" aria-hidden="true" />
          <div className="tp-face">
            <span className={`tp-led${fed ? ' is-done' : ''}`} aria-hidden="true" />
            <span className="tp-brand">Finvoice</span>
          </div>
          <div className="tp-slot" aria-hidden="true"><span className="tp-lip" /></div>
        </div>

        <div className={`tp-wrap${fed ? ' is-fed' : ''}`}>
          <div className="tp-paper">
            {html ? (
              <iframe
                ref={frame}
                title="Receipt"
                sandbox="allow-same-origin"
                srcDoc={html}
                style={{ height }}
                onLoad={() => { fit(); setTimeout(fit, 300); }}
              />
            ) : null}
            <span className="tp-curl" aria-hidden="true" />
          </div>
        </div>
      </div>

      <div className={`tp-actions${fed ? ' is-ready' : ''}`}>
        <Button variant="secondary" icon={<Printer />} onClick={() => frame.current?.contentWindow?.print()}>Print</Button>
        {pdfUrl ? <a className="btn btn-secondary" href={pdfUrl}><Download />PDF</a> : null}
        <Button icon={<Check />} onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
