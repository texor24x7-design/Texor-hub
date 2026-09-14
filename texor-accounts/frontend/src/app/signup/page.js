'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthForm } from '@/components/AuthForm';
import { SocialButtons } from '@/components/SocialButtons';
import { Alert, Logo } from '@/components/ui';
import { auth } from '@/lib/api';

function SignUpContent() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/account';
  const error = params.get('error');

  return (
    <div className="auth-shell">
      <main className="auth-card">
        <div className="auth-card__header stack stack--tight">
          <Logo />
          <h1>Create your Texor Account</h1>
          <p>One account for Finvoice, Talk, Payroll and everything else Texor builds.</p>
        </div>

        <div className="stack">
          <Alert kind="error">{error}</Alert>

          <AuthForm
            mode="signup"
            busyLabel="Creating account…"
            onSubmit={async (values) => {
              await auth.signup(values);
              router.replace(next);
            }}
          />

          {/* The same providers as sign-in: with an upstream account there is
              no difference between signing up and signing in. */}
          <SocialButtons next={next} layout="icons" label="or continue with" />
        </div>

        <div className="auth-card__footer">
          Already have one? <a href={`/signin?next=${encodeURIComponent(next)}`}>Sign in</a>
        </div>
      </main>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpContent />
    </Suspense>
  );
}
