'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthForm } from '@/components/AuthForm';
import { SocialButtons } from '@/components/SocialButtons';
import { Alert, Logo } from '@/components/ui';
import { auth } from '@/lib/api';

function SignInContent() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/account';
  const signedOut = params.get('signed_out');
  // Federated sign-in reports failures by redirecting back here, because a
  // callback from Google has no other way to reach the user.
  const error = params.get('error');

  return (
    <div className="auth-shell">
      <main className="auth-card">
        <div className="auth-card__header stack stack--tight">
          <Logo />
          <h1>Sign in</h1>
          <p>Use your Texor Account to continue.</p>
        </div>

        <div className="stack">
          {signedOut ? <Alert kind="success">You have been signed out.</Alert> : null}
          <Alert kind="error">{error}</Alert>

          <AuthForm
            mode="signin"
            busyLabel="Signing in…"
            onSubmit={async (values) => {
              await auth.login(values);
              router.replace(next);
            }}
          />

          <SocialButtons next={next} layout="icons" label="or continue with" />
        </div>

        <div className="auth-card__footer stack stack--tight">
          <span><a href="/forgot-password">Forgot your password?</a></span>
          <span>New to Texor? <a href={`/signup?next=${encodeURIComponent(next)}`}>Create an account</a></span>
        </div>
      </main>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInContent />
    </Suspense>
  );
}
