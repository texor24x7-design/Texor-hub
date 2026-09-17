'use client';

/**
 * Finvoice UI primitives. Class names come from styles/globals.css; nothing here
 * carries its own styling beyond layout glue, so the whole product restyles from
 * one file.
 */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Info, X } from 'lucide-react';
import Link from 'next/link';
import { initials } from '@/lib/format';

/**
 * `dark` swaps in the variant whose wordmark is drawn in white. Inverting the
 * light logo with a CSS filter also inverted the mint mark, which is the brand.
 */
export function Logo({ size = 'md', dark = false }) {
  return <img className={`logo-img${size === 'lg' ? ' lg' : ''}`} src={dark ? '/brand/finvoice-logo-dark.svg' : '/brand/finvoice-logo.svg'} alt="Texor Finvoice" />;
}

export function Mark({ size = 28 }) {
  return <img src="/brand/finvoice-icon.svg" alt="" width={size} height={size} style={{ display: 'block' }} />;
}

export function Button({ variant = 'primary', size, block, loading, icon, children, className = '', ...props }) {
  const classes = ['btn', `btn-${variant}`, size === 'sm' && 'btn-sm', size === 'lg' && 'btn-lg', block && 'btn-block', !children && 'btn-icon', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} disabled={loading || props.disabled} {...props}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant = 'primary', size, icon, children, className = '', ...props }) {
  const classes = ['btn', `btn-${variant}`, size === 'sm' && 'btn-sm', !children && 'btn-icon', className].filter(Boolean).join(' ');
  return <Link href={href} className={classes} {...props}>{icon}{children}</Link>;
}

export function IconButton({ label, icon, variant = 'ghost', size, ...props }) {
  return <Button variant={variant} size={size} icon={icon} aria-label={label} title={label} {...props} />;
}

export function Field({ label, hint, error, required, htmlFor, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label ? <label className="field-label" htmlFor={htmlFor}>{label}{required ? <span className="req" aria-hidden="true">*</span> : null}</label> : null}
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, id }) {
  return (
    <label className="switch" htmlFor={id}>
      <input id={id} type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

const ALERT_ICONS = { error: AlertCircle, success: CheckCircle2, warning: AlertTriangle, info: Info };

export function Alert({ kind = 'error', children, title }) {
  if (!children && !title) return null;
  const Glyph = ALERT_ICONS[kind] ?? Info;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Glyph aria-hidden="true" />
      <div>{title ? <div className="strong">{title}</div> : null}{children}</div>
    </div>
  );
}

export function Badge({ tone = 'neutral', plain, children, title }) {
  return <span className={`badge badge-${tone}${plain ? ' plain' : ''}`} title={title}>{children}</span>;
}

const STATUS_TONES = {
  draft: 'neutral', issued: 'blue', sent: 'blue', partial: 'amber', paid: 'green', void: 'neutral', overdue: 'red',
  accepted: 'green', declined: 'red', converted: 'violet', expired: 'amber',
  active: 'green', expiring: 'amber', claimed: 'violet',
  present: 'green', absent: 'red', half_day: 'amber', leave: 'blue', holiday: 'neutral', week_off: 'neutral',
  invited: 'amber', disabled: 'neutral', open: 'amber', in_progress: 'blue', resolved: 'green', rejected: 'red',
};
const STATUS_LABELS = { half_day: 'Half day', week_off: 'Week off', in_progress: 'In progress', partial: 'Partly paid' };

export function StatusBadge({ status }) {
  if (!status) return null;
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}

export function Avatar({ name, src, size, square }) {
  return (
    <span className={`avatar${size === 'lg' ? ' avatar-lg' : ''}${square ? ' avatar-square' : ''}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function Loading({ label = 'Loading' }) {
  return (
    <div className="auth-shell">
      <div className="row muted"><Spinner /><span>{label}…</span></div>
    </div>
  );
}

export function Skeleton({ height = 14, width = '100%', style }) {
  return <div className="skeleton" style={{ height, width, ...style }} />;
}

export function SkeletonRows({ rows = 6 }) {
  return (
    <div className="stack-sm" style={{ padding: '1rem' }}>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={18} width={`${90 - (i % 3) * 12}%`} />)}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }) {
  return (
    <div className="empty">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <h3>{title}</h3>
      {children ? <p style={{ maxWidth: 420 }}>{children}</p> : null}
      {action}
    </div>
  );
}

export function PageHeader({ title, description, crumbs = [], actions, badge }) {
  return (
    <div className="page-header">
      <div className="grow">
        {crumbs.length ? (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span className="row" style={{ gap: '0.35rem' }} key={c.href ?? c.label}>
                {i > 0 ? <ChevronRight aria-hidden="true" /> : null}
                {c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
              </span>
            ))}
          </nav>
        ) : null}
        <div className="row wrap"><h1>{title}</h1>{badge}</div>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="row wrap">{actions}</div> : null}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.value} type="button" role="tab" className="tab" aria-selected={tab.value === value} onClick={() => onChange(tab.value)}>
          {tab.icon}{tab.label}{tab.count != null ? <span className="count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} title={o.title}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

/** A native <dialog>: focus trapping, Escape and the backdrop come from the browser. */
export function Dialog({ open, onClose, title, description, children, footer, size }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog${size ? ` ${size}` : ''}`}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose?.(); }}
      onClick={(e) => { if (e.target === ref.current) onClose?.(); }}
    >
      {open ? (
        <>
          <div className="dialog-header">
            <div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>
            <IconButton label="Close" icon={<X />} size="sm" onClick={onClose} />
          </div>
          <div className="dialog-body">{children}</div>
          {footer ? <div className="dialog-footer">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  );
}

/** A dropdown menu that closes on outside click, Escape, or choosing an item. */
export function Menu({ trigger, children, align = 'left', up = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open ? (
        <div className={`menu${align === 'right' ? ' align-right' : ''}${up ? ' up' : ''}`} role="menu" onClick={(e) => { if (e.target.closest('.menu-item')) setOpen(false); }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, href, danger, disabled }) {
  const className = `menu-item${danger ? ' danger' : ''}`;
  if (href) return <Link href={href} className={className} role="menuitem">{icon}{children}</Link>;
  return <button type="button" className={className} role="menuitem" onClick={onClick} disabled={disabled}>{icon}{children}</button>;
}

// ── toasts ────────────────────────────────────────────────────────────────────

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, kind = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((all) => [...all.slice(-3), { id, message, kind }]);
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => {
          const Glyph = t.kind === 'error' ? AlertCircle : CheckCircle2;
          return <div key={t.id} className={`toast ${t.kind}`}><Glyph aria-hidden="true" /><span>{t.message}</span></div>;
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ── confirm ───────────────────────────────────────────────────────────────────

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const confirm = useCallback((options) => new Promise((resolve) => setRequest({ ...options, resolve })), []);
  const close = (value) => { request?.resolve(value); setRequest(null); };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={Boolean(request)}
        onClose={() => close(false)}
        title={request?.title}
        size="narrow"
        footer={(
          <>
            <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
            <Button variant={request?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{request?.confirmLabel ?? 'Confirm'}</Button>
          </>
        )}
      >
        <p className="muted">{request?.message}</p>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

export function Pagination({ page, limit, total, onPage }) {
  if (total <= limit) return total ? <div className="pagination"><span>{total} {total === 1 ? 'record' : 'records'}</span></div> : null;
  const pages = Math.ceil(total / limit);
  const from = (page - 1) * limit + 1;
  return (
    <div className="pagination">
      <span className="num">{from}–{Math.min(page * limit, total)} of {total}</span>
      <div className="row">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export const useFieldId = (name) => `${useId()}-${name}`;
