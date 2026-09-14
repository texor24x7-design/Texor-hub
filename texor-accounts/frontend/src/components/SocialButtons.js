'use client';

import { useEffect, useState } from 'react';
import { API_ORIGIN, auth } from '@/lib/api';

/**
 * "Continue with Google / Microsoft / LinkedIn".
 *
 * The list is fetched rather than hard-coded, so a deployment that has only
 * configured Google shows only Google — a button that leads to a
 * "not available" error is worse than no button.
 *
 * Each is a real link performing a full navigation. Federated sign-in cannot go
 * through fetch(): the user has to actually arrive at the provider so their
 * session there is in play.
 */
/**
 * @param layout  'icons' renders a horizontal row of brand marks with no
 *                labels — the compact form used beneath a sign-in form.
 *                'list' renders full-width labelled buttons, which is clearer
 *                where the action is less obvious, such as connecting an extra
 *                provider from account settings.
 */
export function SocialButtons({ next, interactionUid, mode, label = 'or', layout = 'list' }) {
  const [providers, setProviders] = useState(null);

  useEffect(() => {
    let cancelled = false;
    auth.providers()
      .then((data) => { if (!cancelled) setProviders(data.providers); })
      .catch(() => { if (!cancelled) setProviders([]); });
    return () => { cancelled = true; };
  }, []);

  // Still loading: render nothing rather than flashing a divider that never fills in.
  if (!providers) return null;

  if (providers.length === 0) {
    // In production an unconfigured provider should be invisible. In
    // development, silence is indistinguishable from a bug — this is the note
    // that would have saved someone half an hour.
    if (process.env.NODE_ENV !== 'development') return null;

    return (
      <p className="meta" style={{ textAlign: 'center' }}>
        No social sign-in providers configured. Set a client id and secret in{' '}
        <code>backend/.env</code>, then run <code>npm run check:providers</code>.
      </p>
    );
  }

  const href = (provider) => {
    const params = new URLSearchParams();
    if (next) params.set('next', next);
    if (interactionUid) params.set('interaction', interactionUid);
    if (mode) params.set('mode', mode);
    const query = params.toString();
    return `${API_ORIGIN}${provider.startUrl}${query ? `?${query}` : ''}`;
  };

  const actionLabel = (provider) => (mode === 'link'
    ? `Connect ${provider.displayName}`
    : `Continue with ${provider.displayName}`);

  return (
    <div className="stack">
      {label ? <div className="divider"><span>{label}</span></div> : null}

      {layout === 'icons' ? (
        <div className="social-row">
          {providers.map((provider) => (
            <a
              key={provider.id}
              className="social-btn"
              href={href(provider)}
              // The mark carries no text, so the accessible name has to come
              // from here — and the tooltip tells a sighted user which is which.
              aria-label={actionLabel(provider)}
              title={actionLabel(provider)}
            >
              <ProviderMark id={provider.id} size={22} />
            </a>
          ))}
        </div>
      ) : (
        <div className="stack stack--tight">
          {providers.map((provider) => (
            <a key={provider.id} className="btn btn--secondary btn--block" href={href(provider)}>
              <ProviderMark id={provider.id} />
              {actionLabel(provider)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Brand colours for providers drawn as a lettered tile rather than a traced
 * logo. Used by the fallback below.
 */
const BRAND_COLOR = {
  zoho: '#E42527',
};

/**
 * Last-resort mark: a tile in the provider's colour with its initial.
 *
 * The point is that `ProviderMark` never returns nothing. Returning null for an
 * unrecognised id renders an empty bordered box that looks broken, which is
 * exactly what happened when Zoho was added as a provider without a mark to go
 * with it.
 */
function FallbackMark({ id, size }) {
  const color = BRAND_COLOR[id] ?? '#4f46e5';

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="5" fill={color} />
      <text
        x="12" y="12"
        textAnchor="middle" dominantBaseline="central"
        fill="#ffffff" fontSize="14" fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
      >
        {(id?.[0] ?? '?').toUpperCase()}
      </text>
    </svg>
  );
}

/** Brand marks, inline so a sign-in screen never waits on a network image. */
export function ProviderMark({ id, size = 18 }) {
  if (id === 'google') {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
        <path fill="#FBBC05" d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.17.29-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33z" />
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.17 6.66 3.58 9 3.58z" />
      </svg>
    );
  }

  if (id === 'microsoft') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <path fill="#F25022" d="M0 0h7.6v7.6H0z" />
        <path fill="#7FBA00" d="M8.4 0H16v7.6H8.4z" />
        <path fill="#00A4EF" d="M0 8.4h7.6V16H0z" />
        <path fill="#FFB900" d="M8.4 8.4H16V16H8.4z" />
      </svg>
    );
  }

  if (id === 'zoho') {
    /**
     * Zoho's mark: a ring of four quarter-arcs in a pinwheel — red north-west,
     * green north-east, blue south-east, yellow south-west.
     *
     * The geometry and the four brand colours were measured from Zoho's own
     * favicon rather than drawn by eye: centre (12,12), inner radius 6.29,
     * outer 11.45, with the arcs centred on the diagonals. The 2° seams
     * between them are in the original too.
     */
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
        fill="none" strokeWidth="5.16" strokeLinecap="butt">
        <path d="M20.87 11.85A8.87 8.87 0 0 0 12.15 3.13" stroke="#089949" />
        <path d="M11.85 3.13A8.87 8.87 0 0 0 3.13 11.85" stroke="#E42527" />
        <path d="M3.13 12.15A8.87 8.87 0 0 0 11.85 20.87" stroke="#F9B21D" />
        <path d="M12.15 20.87A8.87 8.87 0 0 0 20.87 12.15" stroke="#226DB4" />
      </svg>
    );
  }

  if (id === 'linkedin') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#0A66C2"
          d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z"
        />
      </svg>
    );
  }

  // Never nothing — an unrecognised provider still gets a visible mark.
  return <FallbackMark id={id} size={size} />;
}

export default SocialButtons;
