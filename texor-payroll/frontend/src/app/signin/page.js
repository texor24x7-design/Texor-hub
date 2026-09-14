'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, Button, Logo } from '@/components/ui';
import { signInWithTexor } from '@/lib/api';

function SignInContent() {
  const params = useSearchParams();
  const error = params.get('error');
  const returnTo = params.get('returnTo') ?? '/pay-runs';

  return (
    <div className="auth-shell">
      <main className="auth-card">
        <div className="auth-card__header stack stack--tight">
          <Logo />
          <h1>Payroll that runs itself</h1>
          <p>Texor Payroll uses your Texor Account, so there is no separate password to remember.</p>
        </div>

        <div className="stack">
          <Alert kind="error">{error}</Alert>

          <Button block onClick={() => signInWithTexor(returnTo)}>
            Continue with Texor
          </Button>

          <p className="meta center">
            You will be taken to accounts.texor.app and brought straight back.
          </p>
        </div>

        <div className="auth-card__footer">
          Part of the Texor ecosystem — one account for Texor Payroll, Talk and Payroll.
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
