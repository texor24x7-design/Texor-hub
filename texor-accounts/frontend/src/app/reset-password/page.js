'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Button, Field, Logo } from '@/components/ui';
import { auth } from '@/lib/api';

function ResetPasswordContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');

  const [values, setValues] = useState({ newPassword: '', confirmPassword: '' });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setValues((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    if (values.newPassword !== values.confirmPassword) {
      setFieldErrors({ confirmPassword: 'The two passwords do not match.' });
      return;
    }

    setBusy(true);
    try {
      await auth.resetPassword(token, values.newPassword);
      // The reset signs this browser in, so there is nowhere better to go.
      router.replace('/account');
    } catch (submitError) {
      setError(submitError.message);
      setFieldErrors(submitError.fieldErrors ?? {});
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-shell">
        <main className="auth-card">
          <div className="auth-card__header stack stack--tight">
            <Logo />
            <h1>That link is incomplete</h1>
          </div>
          <Alert kind="error">The reset link is missing its token. Request a new one.</Alert>
          <div className="auth-card__footer">
            <a href="/forgot-password">Request a new link</a>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <main className="auth-card">
        <div className="auth-card__header stack stack--tight">
          <Logo />
          <h1>Choose a new password</h1>
          <p>You will be signed out everywhere else.</p>
        </div>

        <form className="stack" onSubmit={submit}>
          <Alert kind="error">{error}</Alert>

          <Field
            label="New password" htmlFor="newPassword" error={fieldErrors.newPassword}
            hint="At least 12 characters, with upper and lower case and a number."
          >
            <input
              id="newPassword" className="input" type="password" autoComplete="new-password"
              required autoFocus value={values.newPassword} onChange={set('newPassword')}
            />
          </Field>

          <Field label="Confirm new password" htmlFor="confirmPassword" error={fieldErrors.confirmPassword}>
            <input
              id="confirmPassword" className="input" type="password" autoComplete="new-password"
              required value={values.confirmPassword} onChange={set('confirmPassword')}
            />
          </Field>

          <Button type="submit" block loading={busy}>
            {busy ? 'Saving…' : 'Set new password'}
          </Button>
        </form>
      </main>
    </div>
  );
}

export default function ResetPasswordPage() {
  return <Suspense><ResetPasswordContent /></Suspense>;
}
