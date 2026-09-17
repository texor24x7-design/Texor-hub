'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, LogOut, Plus } from 'lucide-react';
import { Alert, Badge, Button, Loading, Logo } from '@/components/ui';
import { ACCOUNTS_ORIGIN, api, auth, fileUrl } from '@/lib/api';

export default function Workspaces() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    (async () => {
      const me = await auth.me();
      if (!me.user) { router.replace('/signin?returnTo=/workspaces'); return; }
      setUser(me.user);
      setData(await api('/api/workspaces'));
    })().catch(() => setData({ workspaces: [], error: true }));
  }, [router]);

  if (!data) return <Loading label="Loading your businesses" />;

  return (
    <div className="auth-shell">
      <main className="auth-card" style={{ maxWidth: '32rem' }}>
        <div className="auth-card__header">
          <Logo />
          <h1>Choose a business</h1>
          <p>Signed in as {user?.email}.</p>
        </div>
        <div className="stack">
          {data.unverifiedInvites ? (
            <Alert kind="warning" title={`You have ${data.unverifiedInvites} pending invitation${data.unverifiedInvites > 1 ? 's' : ''}`}>
              Verify your email in your {ACCOUNTS_ORIGIN ? <a href={ACCOUNTS_ORIGIN}>Texor Account</a> : 'Texor Account'} to accept — invitations only open for verified addresses.
            </Alert>
          ) : null}
          <div className="card" style={{ overflow: 'hidden' }}>
            {data.workspaces.map((w) => (
              <Link key={w._id} href={`/w/${w.slug}`} className="list-row" style={{ padding: '0.8rem 1rem' }}>
                <span className={`ws-logo${w.branding?.logo ? ' ws-logo--image' : ''}`} style={w.branding?.logo ? undefined : { background: w.branding?.accent ?? 'var(--brand-500)' }}>
                  {w.branding?.logo ? <img src={fileUrl(w.branding.logo)} alt="" /> : w.name[0]}
                </span>
                <span className="grow"><span className="strong" style={{ display: 'block' }}>{w.name}</span><span className="tiny subtle">{w.industryName} · {w.role}</span></span>
                {w.edition === 'pro' ? <span className="pro-chip">PRO</span> : <Badge tone="neutral" plain>Lite</Badge>}
                <ChevronRight size={16} color="var(--text-subtle)" />
              </Link>
            ))}
            {!data.workspaces.length ? <div className="list-row muted">You are not part of any business yet.</div> : null}
          </div>
          <Link href="/onboarding" className="btn btn-primary btn-block"><Plus />Set up a new business</Link>
          <Button variant="ghost" icon={<LogOut />} onClick={() => auth.logout()}>Sign out</Button>
        </div>
      </main>
    </div>
  );
}


