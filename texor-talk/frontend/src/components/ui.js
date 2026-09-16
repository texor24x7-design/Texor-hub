/**
 * Texor Talk UI primitives. Mirrors the Texor Account component set so the two
 * feel like one product family.
 */
/**
 * The product mark.
 *
 * The supplied logo file, used as it was drawn — mark and wordmark together,
 * not a mark beside text set to look like one. It used to be the latter, which
 * meant the letterforms were whatever the interface font happened to be and
 * drifted every time that changed.
 *
 * `size` is a height; the width follows the artwork's own 372:110.
 *
 * ── Why there is no dark variant here any more ──
 *
 * There was one: the supplied file sets its wordmark in black, so a copy with
 * those fills lightened was offered beside it and the browser chose between
 * them on `prefers-color-scheme`.
 *
 * That choice is made by the browser from the *operating system*, not from
 * this product's stylesheet — so once the app was pinned to light, a machine
 * in dark mode got the light-on-dark logo on a white page, which is the one
 * combination neither cut is drawn for. The surfaces this sits on are light on
 * every machine now, so the supplied file is simply correct.
 * `public/brand/talk-logo-dark.svg` is kept for whenever there is a dark
 * surface to put it on.
 */
const LOGO_RATIO = 372 / 110;

export function Logo({ size = 34 }) {
  return (
    <img
      className="logo logo__lockup"
      src="/brand/talk-logo.svg"
      alt="Texor Talk"
      width={Math.round(size * LOGO_RATIO)}
      height={size}
    />
  );
}

/** Just the mark, for places with no room for the name. */
export function LogoIcon({ size = 28 }) {
  return (
    <img src="/brand/talk-icon.svg" alt="Texor Talk" width={size} height={size} className="logo__icon" />
  );
}

export function TexorMark() {
  return (
    <span className="meta row" style={{ gap: '0.35rem' }}>
      <span
        aria-hidden="true"
        style={{
          width: 14, height: 14, borderRadius: 4, display: 'inline-grid', placeItems: 'center',
          background: 'linear-gradient(140deg, #6366f1, #3730a3)', color: '#fff',
          fontSize: 9, fontWeight: 700,
        }}
      >T</span>
      Texor Account
    </span>
  );
}

export function Field({ label, hint, error, children, htmlFor }) {
  return (
    <div className="field">
      {label ? <label className="field__label" htmlFor={htmlFor}>{label}</label> : null}
      {children}
      {error ? <span className="field__error">{error}</span> : null}
      {!error && hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

export function Alert({ kind = 'error', children }) {
  if (!children) return null;
  return <div className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Button({ variant = 'primary', block, size, loading, className, children, ...props }) {
  return (
    <button
      // `className` is pulled out of props and merged, not spread: spreading it
      // after this attribute would replace the computed classes outright and
      // leave an unstyled button behind.
      className={[
        'btn',
        `btn--${variant}`,
        block ? 'btn--block' : '',
        size === 'sm' ? 'btn--sm' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Avatar({ user }) {
  const initials = (user?.displayName ?? user?.email ?? '?')
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0].toUpperCase()).join('');

  return (
    <span className="avatar">
      {user?.picture ? <img src={user.picture} alt="" /> : initials}
    </span>
  );
}

export function Loading({ label = 'Loading' }) {
  return (
    <div className="auth-shell">
      <div className="row" style={{ color: 'var(--text-muted)' }}>
        <span className="spinner" aria-hidden="true" />
        <span>{label}&hellip;</span>
      </div>
    </div>
  );
}

export const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** "14:32" for today, "12 Mar 14:32" for anything older. */
export const formatTimestamp = (value) => {
  const date = new Date(value);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday ? time : `${formatDate(date)} ${time}`;
};
