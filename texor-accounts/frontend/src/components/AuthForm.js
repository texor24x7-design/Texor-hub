'use client';

import { useState } from 'react';
import { Alert, Button, Field } from '@/components/ui';

/**
 * The credential form shared by /signin, /signup and the OIDC login prompt, so
 * all three behave identically — same validation messages, same loading state,
 * same inline field errors.
 */
export function AuthForm({ mode = 'signin', onSubmit, submitLabel, busyLabel }) {
  const isSignup = mode === 'signup';

  const [values, setValues] = useState({
    email: '',
    password: '',
    givenName: '',
    familyName: '',
    phone: '',
  });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setValues((prev) => ({ ...prev, [key]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);

    try {
      await onSubmit(isSignup ? values : { email: values.email, password: values.password });
    } catch (submitError) {
      setError(submitError.message);
      setFieldErrors(submitError.fieldErrors ?? {});
      setBusy(false);
    }
    // On success the caller navigates away, so `busy` intentionally stays true
    // to prevent a double submission during the redirect.
  }

  return (
    <form className="stack" onSubmit={handleSubmit} noValidate>
      <Alert kind="error">{error}</Alert>

      {isSignup ? (
        <div className="row" style={{ gap: '0.75rem' }}>
          <div className="grow">
            <Field label="First name" htmlFor="givenName" error={fieldErrors.givenName}>
              <input
                id="givenName"
                className="input"
                autoComplete="given-name"
                value={values.givenName}
                onChange={set('givenName')}
              />
            </Field>
          </div>
          <div className="grow">
            <Field label="Last name" htmlFor="familyName" error={fieldErrors.familyName}>
              <input
                id="familyName"
                className="input"
                autoComplete="family-name"
                value={values.familyName}
                onChange={set('familyName')}
              />
            </Field>
          </div>
        </div>
      ) : null}

      <Field label="Email" htmlFor="email" error={fieldErrors.email}>
        <input
          id="email"
          className="input"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoFocus
          required
          aria-invalid={Boolean(fieldErrors.email)}
          value={values.email}
          onChange={set('email')}
        />
      </Field>

      {isSignup ? (
        <Field
          label="Phone number"
          htmlFor="phone"
          error={fieldErrors.phone}
          hint="Optional. International format, like +14155550123."
        >
          <input
            id="phone"
            className="input"
            type="tel"
            autoComplete="tel"
            placeholder="+14155550123"
            aria-invalid={Boolean(fieldErrors.phone)}
            value={values.phone}
            onChange={set('phone')}
          />
        </Field>
      ) : null}

      <Field
        label="Password"
        htmlFor="password"
        error={fieldErrors.password}
        hint={isSignup ? 'At least 12 characters, with upper and lower case and a number.' : undefined}
      >
        <input
          id="password"
          className="input"
          type="password"
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          required
          aria-invalid={Boolean(fieldErrors.password)}
          value={values.password}
          onChange={set('password')}
        />
      </Field>

      <Button type="submit" block loading={busy}>
        {busy ? (busyLabel ?? 'Working…') : (submitLabel ?? (isSignup ? 'Create account' : 'Sign in'))}
      </Button>
    </form>
  );
}

export default AuthForm;
