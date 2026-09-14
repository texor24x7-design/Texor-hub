'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, Logo } from '@/components/ui';

/**
 * Where the provider's `renderError` sends the browser when an authorization
 * request cannot be honoured — a bad redirect_uri, an unknown client, an
 * expired interaction.
 */
function ErrorContent() {
  const params = useSearchParams();
  const code = params.get('error') ?? 'server_error';
  const description = params.get('error_description');

  return (
    <div className="auth-shell">
      <main className="auth-card">
        <div className="auth-card__header stack stack--tight">
          <Logo />
          <h1>That sign-in request could not be completed</h1>
        </div>

        <div className="stack">
          <Alert kind="error">{description || 'The request was rejected by Texor Account.'}</Alert>
          <p className="meta">
            Error code: <span className="mono">{code}</span>
          </p>
          <p className="muted" style={{ fontSize: '0.875rem' }}>
            This usually means the product sent an invalid request, or you took too long to
            finish signing in. Go back to the product and try again.
          </p>
        </div>

        <div className="auth-card__footer">
          <a href="/account">Go to your Texor Account</a>
        </div>
      </main>
    </div>
  );
}

export default function ErrorPage() {
  return (
    <Suspense>
      <ErrorContent />
    </Suspense>
  );
}
