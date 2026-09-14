'use client';

import { useState } from 'react';
import { Alert, Button, Field, Logo } from '@/components/ui';
import { auth } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await auth.forgotPassword(email);
      // The response is deliberately the same whether or not the address has
      // an account, so this screen says the same thing either way.
      setSent(true);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <main className="auth-card">
        <div className="auth-card__header stack stack--tight">
          <Logo />
          <h1>{sent ? 'Check your inbox' : 'Forgot your password?'}</h1>
          {!sent ? <p>We will email you a link to choose a new one.</p> : null}
        </div>

        {sent ? (
          <div className="stack">
            <Alert kind="success">
              If <strong>{email}</strong> has a Texor Account, a reset link is on its way.
              It expires in 30 minutes.
            </Alert>
            <p className="muted" style={{ fontSize: '0.875rem' }}>
              Nothing arrived? Check spam, and make sure you used the address you signed up with.
            </p>
            <a href="/signin" className="btn btn--secondary btn--block">Back to sign in</a>
          </div>
        ) : (
          <form className="stack" onSubmit={submit}>
            <Alert kind="error">{error}</Alert>

            <Field label="Email" htmlFor="email">
              <input
                id="email" className="input" type="email" autoComplete="username"
                required autoFocus value={email} onChange={(event) => setEmail(event.target.value)}
              />
            </Field>

            <Button type="submit" block loading={busy}>
              {busy ? 'Sending…' : 'Email me a reset link'}
            </Button>
          </form>
        )}

        <div className="auth-card__footer">
          Remembered it? <a href="/signin">Sign in</a>
        </div>
      </main>
    </div>
  );
}
