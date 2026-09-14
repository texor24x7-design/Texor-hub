'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, Button, Logo } from '@/components/ui';
import { auth } from '@/lib/api';

function VerifyEmailContent() {
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState({ status: 'working', message: null, user: null });

  // React runs effects twice in development; a verification token is single
  // use, so the second run would report "already used" on a success.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setState({ status: 'failed', message: 'That link is missing its token.' });
      return;
    }

    auth.verifyEmail(token)
      .then(({ user }) => setState({ status: 'done', user }))
      .catch((error) => setState({ status: 'failed', message: error.message }));
  }, [token]);

  return (
    <div className="auth-shell">
      <main className="auth-card">
        <div className="auth-card__header stack stack--tight">
          <Logo />
          <h1>
            {state.status === 'working' ? 'Confirming your address…' : null}
            {state.status === 'done' ? 'Email confirmed' : null}
            {state.status === 'failed' ? 'That link did not work' : null}
          </h1>
        </div>

        <div className="stack">
          {state.status === 'working' ? (
            <div className="row" style={{ color: 'var(--text-muted)' }}>
              <span className="spinner" aria-hidden="true" />
              <span>One moment.</span>
            </div>
          ) : null}

          {state.status === 'done' ? (
            <>
              <Alert kind="success">
                <strong>{state.user?.email}</strong> is confirmed. You are signed in.
              </Alert>
              <a href="/account" className="btn btn--primary btn--block">Go to your account</a>
            </>
          ) : null}

          {state.status === 'failed' ? (
            <>
              <Alert kind="error">{state.message}</Alert>
              <p className="muted" style={{ fontSize: '0.875rem' }}>
                Confirmation links expire after 24 hours and work once. Sign in and ask for a
                new one from the banner at the top of your account.
              </p>
              <a href="/account" className="btn btn--secondary btn--block">Go to your account</a>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

export default function VerifyEmailPage() {
  return <Suspense><VerifyEmailContent /></Suspense>;
}
