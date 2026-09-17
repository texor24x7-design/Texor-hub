'use client';

/**
 * Adding a signature: draw it, or upload one.
 *
 * Whatever arrives is prepared before it is stored — the paper background is
 * lifted off a photograph and the image is trimmed to the strokes — and the
 * screen says what it did and what is still wrong, rather than quietly storing
 * something that will print as a grey box.
 */
import { useRef, useState } from 'react';
import { AlertTriangle, Check, Eraser, Info, PenLine, Trash2, Upload } from 'lucide-react';
import { Alert, Button, Field, Segmented, Switch, useToast } from '@/components/ui';
import { fileUrl } from '@/lib/api';
import { MIN_PRINT_WIDTH, prepareSignature } from '@/lib/signature.mjs';
import { useWorkspace } from '@/lib/workspace';

const MAX_SIDE = 1600;

export const SIGNATURE_TIPS = [
  'A PNG with a transparent background is ideal — or photograph your signature on plain white paper.',
  'Sign with a black or dark blue pen. Pencil and light ink fade out when printed.',
  `Fill the frame with the signature: at least ${MIN_PRINT_WIDTH} px wide, with no shadows or ruled lines.`,
  'Finvoice removes the paper background and crops to the ink for you.',
];

/** File → pixels, scaled down so a 12 MP phone photo is not processed at full size. */
async function imageDataFrom(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return ctx.getImageData(0, 0, width, height);
}

/** Pixels → a transparent PNG file, ready to upload. */
function toPngFile({ data, width, height }, name = 'signature.png') {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(new File([blob], name, { type: 'image/png' })), 'image/png'));
}

export function SignaturePad({ onReady }) {
  const canvas = useRef(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  const setup = (node) => {
    if (!node || node === canvas.current) return;
    canvas.current = node;
    const ratio = window.devicePixelRatio || 1;
    node.width = node.offsetWidth * ratio;
    node.height = node.offsetHeight * ratio;
    const ctx = node.getContext('2d', { willReadFrequently: true });
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#10213d';
  };

  const point = (e) => {
    const rect = canvas.current.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const clear = () => {
    const c = canvas.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  };

  return (
    <div className="stack-sm">
      <canvas
        ref={setup}
        className="sig-pad"
        onPointerDown={(e) => { drawing.current = true; canvas.current.setPointerCapture(e.pointerId); const ctx = canvas.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(...point(e)); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = canvas.current.getContext('2d'); ctx.lineTo(...point(e)); ctx.stroke(); setEmpty(false); }}
        onPointerUp={() => { drawing.current = false; }}
        aria-label="Signature drawing area"
      />
      <div className="row">
        <span className="tiny subtle grow">Sign with your mouse, or a finger on a touchscreen.</span>
        <Button variant="ghost" size="sm" icon={<Eraser />} onClick={clear} disabled={empty}>Clear</Button>
        <Button size="sm" disabled={empty} onClick={() => {
          const c = canvas.current;
          const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height);
          onReady(pixels, 'drawing.png');
        }}>Use this signature</Button>
      </div>
    </div>
  );
}

const APPLIED_LABELS = {
  background: 'Paper background removed, so it prints as ink on your invoice',
  trim: 'Cropped to the signature itself',
};

export function SignatureField({ value, onChange, purpose = 'signature' }) {
  const { api } = useWorkspace();
  const toast = useToast();
  const fileInput = useRef(null);
  const [mode, setMode] = useState('draw');
  const [pending, setPending] = useState(null);
  const [removePaper, setRemovePaper] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function inspect(source, name, paper) {
    setError(null);
    const result = prepareSignature(source, { removePaper: paper });
    if (!result.image) {
      setPending(null);
      setError(result.issues[0]?.message ?? 'That image cannot be used.');
      return;
    }
    const file = await toPngFile(result.image, name);
    setPending({ ...result, file, source, name, preview: URL.createObjectURL(file) });
  }

  async function chooseFile(file) {
    if (!file) return;
    setBusy(true);
    try {
      const pixels = await imageDataFrom(file);
      setRemovePaper(true);
      await inspect(pixels, file.name.replace(/\.[^.]+$/, '.png'), undefined);
    } catch {
      setError('That file could not be read. Try a PNG or JPEG.');
    } finally {
      setBusy(false);
    }
  }

  async function togglePaper(next) {
    setRemovePaper(next);
    if (pending) await inspect(pending.source, pending.name, next);
  }

  async function save() {
    setBusy(true);
    try {
      // `maxSide: 0` keeps our own trimmed size — the generic uploader's resize would undo the crop.
      const { file: saved } = await api.upload(pending.file, purpose, { maxSide: 0 });
      await onChange(saved.key);
      setPending(null);
      toast('Signature saved');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row row-between wrap">
        <Segmented label="How to add your signature" value={mode} onChange={(next) => { setMode(next); setPending(null); setError(null); }}
          options={[{ value: 'draw', label: 'Draw', icon: <PenLine /> }, { value: 'upload', label: 'Upload', icon: <Upload /> }]} />
        {value ? <Button variant="ghost" size="sm" icon={<Trash2 />} onClick={() => onChange(null)}>Remove current</Button> : null}
      </div>

      <div className="grid-2">
        <div className="stack-sm">
          {mode === 'draw' ? (
            <SignaturePad onReady={(pixels, name) => inspect(pixels, name, false)} />
          ) : (
            <>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => chooseFile(e.target.files?.[0])} />
              <button type="button" className="upload-tile" style={{ minHeight: 160 }} onClick={() => fileInput.current?.click()} disabled={busy}>
                {busy ? <span className="spinner" /> : <Upload aria-hidden="true" />}
                <span className="strong">{busy ? 'Reading the image…' : 'Choose a signature image'}</span>
                <span className="tiny subtle">PNG, JPEG or WebP — a photo of paper is fine</span>
              </button>
            </>
          )}

          <div className="sig-tips">
            <div className="row" style={{ gap: 6 }}><Info size={14} /><span className="strong small">What works best</span></div>
            <ul>{SIGNATURE_TIPS.map((tip) => <li key={tip}>{tip}</li>)}</ul>
          </div>
        </div>

        <div className="stack-sm">
          <Field label={pending ? 'Ready to save' : 'On your invoices'}>
            <div className="sig-preview">
              {pending ? <img src={pending.preview} alt="Prepared signature" />
                : value ? <img src={fileUrl(value)} alt="Your signature" />
                  : <span className="subtle small">No signature yet</span>}
              <span className="sig-preview__rule" />
              <span className="tiny subtle">Authorised signatory</span>
            </div>
          </Field>

          {error ? <Alert kind="error">{error}</Alert> : null}

          {pending ? (
            <>
              <div className="sig-report">
                {pending.applied.map((key) => <div className="row small" key={key}><Check size={15} color="var(--success)" />{APPLIED_LABELS[key]}</div>)}
                {pending.issues.map((issue) => <div className="row row-top small" key={issue.code}><AlertTriangle size={15} color="var(--warning)" style={{ marginTop: 2 }} /><span>{issue.message}</span></div>)}
                {!pending.applied.length && !pending.issues.length ? <div className="row small"><Check size={15} color="var(--success)" />Looks good — clear ink on a transparent background.</div> : null}
                <div className="tiny subtle">{pending.image.width} × {pending.image.height} px</div>
              </div>
              {mode === 'upload' ? <Switch checked={removePaper} onChange={togglePaper} label="Remove the paper background" /> : null}
              <div className="row row-end">
                <Button variant="secondary" onClick={() => { setPending(null); setError(null); }}>Start again</Button>
                <Button onClick={save} loading={busy}>Save signature</Button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
