/**
 * Shared presentational pieces for the Texor Account UI.
 *
 * Deliberately small and dependency-free — the sign-in screen is the most
 * load-bearing page in the ecosystem and should not wait on a component library.
 */
export function Logo({ subtitle = 'Account' }) {
  return (
    <span className="logo">
      <span className="logo__mark" aria-hidden="true">T</span>
      <span className="logo__text">
        Texor{subtitle ? <span>&nbsp;{subtitle}</span> : null}
      </span>
    </span>
  );
}

export function Field({ label, hint, error, children, htmlFor }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>{label}</label>
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

export function Button({ variant = 'primary', block, size, loading, children, ...props }) {
  return (
    <button
      className={[
        'btn',
        `btn--${variant}`,
        block ? 'btn--block' : '',
        size === 'sm' ? 'btn--sm' : '',
      ].filter(Boolean).join(' ')}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Avatar({ user, size }) {
  const initials = (user?.displayName ?? user?.email ?? '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

  return (
    <span className={`avatar${size === 'lg' ? ' avatar--lg' : ''}`}>
      {user?.picture ? <img src={user.picture} alt="" /> : initials}
    </span>
  );
}

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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

/**
 * Human wording for OIDC scopes. Anything unmapped falls back to the raw scope
 * so a newly added scope is still shown rather than silently hidden.
 */
const SCOPE_COPY = {
  openid: { title: 'Confirm your identity', body: 'Your unique Texor account ID.' },
  profile: { title: 'See your basic profile', body: 'Your name, picture, language and time zone.' },
  email: { title: 'See your email address', body: 'The email address on your Texor Account.' },
  offline_access: { title: 'Stay signed in', body: 'Keep you signed in without asking again each time.' },
};

export function describeScope(scope) {
  return SCOPE_COPY[scope] ?? { title: scope, body: 'Access granted to this product.' };
}
