'use client';

import { useEffect, useRef, useState } from 'react';
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

  const links = [
    ['/meetings', 'Meetings'],
    ['/channels', 'Channels'],
    // Only drawn for admins. The API refuses the pages behind it to everyone
    // else regardless, so this is tidiness, not a control.
    ...(user.isAdmin ? [['/admin', 'Admin']] : []),
  ];

  return (
    <div className="console">
      <header className="console__bar">
        <div className="console__bar-inner">
          {/* The wordmark collapses to just the mark on a phone — the three
              destinations beside it are what people actually came to tap. */}
          <a href="/meetings" className="console__logo" aria-label="Texor Talk">
            <Logo />
          </a>

          <nav className="console__nav" aria-label="Sections">
            {links.map(([href, label]) => (
              <a
                key={href}
                href={href}
                aria-current={pathname.startsWith(href) ? 'page' : undefined}
              >
                {label}
              </a>
            ))}
          </nav>

          <AccountMenu user={user} />
        </div>
      </header>

      <div className="console__body">
        {typeof children === 'function' ? children(user) : children}
      </div>
    </div>
  );
}

/**
 * The account control.
 *
 * On a wide screen the name sits beside the avatar and Sign out is one click.
 * On a phone all of that is a menu behind the avatar, because a name of unknown
 * length and a button are the two things most likely to push a header off the
 * side of the screen — and neither is what someone opened the app to do.
 */
function AccountMenu({ user }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const dismiss = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && wrap.current?.contains(event.target)) return;
      setOpen(false);
    };

    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, [open]);

  return (
    <div className="account" ref={wrap}>
      <button
        type="button"
        className="account__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account: ${user.displayName}`}
        onClick={() => setOpen((was) => !was)}
      >
        <Avatar user={user} />
        <span className="account__who">
          <span className="account__name">{user.displayName}</span>
          <TexorMark />
        </span>
      </button>

      {open ? (
        <div className="account__menu" role="menu">
          <div className="account__header">
            <Avatar user={user} />
            <div style={{ minWidth: 0 }}>
              <div className="account__name account__name--full">{user.displayName}</div>
              <div className="meta account__email">{user.email}</div>
            </div>
          </div>

          <a className="account__item" href="/meetings" role="menuitem">Meetings</a>
          <a className="account__item" href="/channels" role="menuitem">Channels</a>
          {user.isAdmin ? <a className="account__item" href="/admin" role="menuitem">Admin</a> : null}

          <button
            type="button"
            className="account__item account__item--danger"
            role="menuitem"
            onClick={() => auth.logout()}
          >
            Sign out
          </button>
        </div>
      ) : null}

      {/* Wide screens keep Sign out as a first-class control rather than
          burying a one-click action two taps deep. */}
      <Button
        variant="secondary"
        size="sm"
        className="account__signout"
        onClick={() => auth.logout()}
      >
        Sign out
      </Button>
    </div>
  );
}

export default AppShell;
