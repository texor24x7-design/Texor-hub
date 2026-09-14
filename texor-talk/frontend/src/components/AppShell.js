'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Avatar, Button, Loading, Logo, TexorMark } from '@/components/ui';
import { auth } from '@/lib/api';

/**
 * Chrome for every signed-in Texor Talk page.
 *
 * Bounces to /signin when there is no session, and surfaces the Texor identity
 * so it is always clear which account the data belongs to.
 */
export function AppShell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    let cancelled = false;

    auth.me()
      .then((data) => {
        if (cancelled) return;
        if (!data.user) {
          router.replace(`/signin?returnTo=${encodeURIComponent(pathname)}`);
          return;
        }
        setUser(data.user);
      })
      .catch(() => { if (!cancelled) router.replace('/signin'); });

    return () => { cancelled = true; };
  }, [router, pathname]);

  if (user === undefined) return <Loading label="Loading Texor Talk" />;

  return (
    <div className="console">
      <header className="console__bar">
        <div className="row row--between" style={{ maxWidth: '62rem', margin: '0 auto' }}>
          <div className="row" style={{ gap: '1rem' }}>
            <Logo />
            <nav className="row" style={{ gap: '0.25rem' }}>
              <a href="/meetings" className="btn btn--ghost btn--sm">Meetings</a>
              <a href="/channels" className="btn btn--ghost btn--sm">Channels</a>
              {/* Only drawn for admins. The API refuses the pages behind it to
                  everyone else regardless, so this is tidiness, not a control. */}
              {user.isAdmin ? <a href="/admin" className="btn btn--ghost btn--sm">Admin</a> : null}
            </nav>
          </div>

          <div className="row">
            <Avatar user={user} />
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 550 }}>{user.displayName}</div>
              <TexorMark />
            </div>
            <Button variant="secondary" size="sm" onClick={() => auth.logout()}>Sign out</Button>
          </div>
        </div>
      </header>

      <div className="console__body">
        {typeof children === 'function' ? children(user) : children}
      </div>
    </div>
  );
}

export default AppShell;
