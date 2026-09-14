'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Alert, Avatar, Button, Loading, Logo } from '@/components/ui';
import {
  CloseIcon, CodeIcon, GridIcon, LogOutIcon, MenuIcon, ShieldIcon, UserIcon,
} from '@/components/icons';
import { API_ORIGIN, account, auth } from '@/lib/api';

const NAV = [
  {
    label: 'Account',
    items: [
      { href: '/account', label: 'Profile', icon: UserIcon, exact: true },
      { href: '/account/security', label: 'Security', icon: ShieldIcon },
      { href: '/account/apps', label: 'Apps with access', icon: GridIcon },
    ],
  },
  {
    label: 'Develop',
    items: [
      { href: '/console', label: 'Your apps', icon: CodeIcon },
    ],
  },
];

/**
 * Chrome for every signed-in page.
 *
 * A persistent sidebar on desktop; below 900px the same markup becomes a
 * slide-in drawer, so there is one navigation to maintain rather than two.
 *
 * Children may be a function, which receives the loaded user and a setter, so
 * pages do not each re-fetch the account.
 */
export function AppShell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    auth.me()
      .then((data) => {
        if (cancelled) return;
        if (!data.user) {
          router.replace(`/signin?next=${encodeURIComponent(pathname)}`);
          return;
        }
        setUser(data.user);
      })
      .catch(() => { if (!cancelled) router.replace('/signin'); });

    return () => { cancelled = true; };
  }, [router, pathname]);

  // The drawer is a navigation overlay: any route change should dismiss it.
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const signOut = useCallback(async () => {
    // Clear the Texor session first, then hand off to the provider's
    // end_session endpoint so its own session cookie goes too. Without the
    // second step the user appears signed out but is silently signed in
    // everywhere else.
    const { endSessionUrl } = await auth.endSessionUrl().catch(() => ({ endSessionUrl: null }));
    await auth.logout().catch(() => {});
    window.location.href = endSessionUrl ?? `${API_ORIGIN}/signin?signed_out=1`;
  }, []);

  if (user === undefined) return <Loading label="Loading your account" />;

  const isCurrent = (item) => (item.exact ? pathname === item.href : pathname.startsWith(item.href));

  return (
    <div className="shell">
      {drawerOpen ? (
        <button type="button" className="scrim" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />
      ) : null}

      <aside className="sidebar" data-open={drawerOpen} id="texor-nav">
        <div className="sidebar__brand row row--between">
          <Logo />
          <button
            type="button" className="icon-btn" onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation" style={{ display: drawerOpen ? 'grid' : 'none' }}
          >
            <CloseIcon />
          </button>
        </div>

        <nav>
          {NAV.map((section) => (
            <div className="sidebar__section" key={section.label}>
              <div className="sidebar__label">{section.label}</div>
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className="sidebar__link"
                    aria-current={isCurrent(item) ? 'page' : undefined}
                  >
                    <Icon />
                    {item.label}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__user">
            <Avatar user={user} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="sidebar__user-name">{user.displayName}</div>
              <div className="sidebar__user-mail">{user.email}</div>
            </div>
          </div>
          <button type="button" className="sidebar__link" onClick={signOut} style={{ width: '100%', marginTop: '0.35rem', background: 'none', border: 0, cursor: 'pointer', font: 'inherit' }}>
            <LogOutIcon />
            Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="main__bar">
          <button
            type="button" className="icon-btn" onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation" aria-expanded={drawerOpen} aria-controls="texor-nav"
          >
            <MenuIcon />
          </button>
          <div className="grow"><Logo /></div>
          <Avatar user={user} />
        </header>

        <div className="main__body">
          <VerifyEmailBanner user={user} />
          {typeof children === 'function' ? children(user, setUser) : children}
        </div>
      </div>
    </div>
  );
}

/**
 * Sits above every page until the address is confirmed.
 *
 * Persistent rather than dismissible: an unverified address means password
 * recovery cannot reach the person, which is worth continuing to say.
 */
function VerifyEmailBanner({ user }) {
  const [state, setState] = useState({ sending: false, sent: false, error: null });

  if (!user || user.emailVerified) return null;

  async function resend() {
    setState({ sending: true, sent: false, error: null });
    try {
      const result = await account.sendVerification();
      setState({
        sending: false,
        sent: true,
        error: result.delivered ? null : 'Email is not configured on this deployment — the link was written to the server log.',
      });
    } catch (error) {
      setState({ sending: false, sent: false, error: error.message });
    }
  }

  if (state.sent && !state.error) {
    return (
      <div style={{ marginBottom: '1.5rem' }}>
        <Alert kind="success">
          Confirmation sent to <strong>{user.email}</strong>. Check your inbox.
        </Alert>
      </div>
    );
  }

  return (
    <div className="banner">
      <span className="banner__text">
        <strong>Confirm your email address.</strong> Until you do, we cannot help you back into
        your account if you forget your password.
      </span>
      <Button variant="secondary" size="sm" onClick={resend} loading={state.sending}>
        {state.sending ? 'Sending…' : 'Send the link again'}
      </Button>
      {state.error ? <span className="banner__text">{state.error}</span> : null}
    </div>
  );
}

export default AppShell;
