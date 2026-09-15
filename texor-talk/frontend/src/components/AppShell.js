'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Avatar, Loading, Logo } from '@/components/ui';
import {
  CalendarIcon, ChatIcon, GridDotsIcon, MenuIcon, SettingsIcon, ShieldIcon, VideoPlusIcon,
} from '@/components/icons';
import { SettingsDialog } from '@/components/SettingsDialog';
import { auth } from '@/lib/api';
import { ACCOUNTS_ORIGIN, PRODUCTS } from '@/lib/ecosystem';

/**
 * Chrome for every signed-in Texor Talk page.
 *
 * A rail down the side rather than links across the top. With a handful of
 * destinations that never grow, a rail keeps them all visible and always in the
 * same place, and gives the top bar back to the two things people actually come
 * here to do: start a meeting, or join one by code.
 */
export function AppShell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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

  const destinations = [
    { href: '/meetings', label: 'Meetings', icon: <CalendarIcon /> },
    { href: '/channels', label: 'Channels', icon: <ChatIcon /> },
    ...(user.isAdmin ? [{ href: '/admin', label: 'Admin', icon: <ShieldIcon /> }] : []),
  ];

  return (
    <div className="shell">
      <header className="shell__top">
        <div className="shell__brand">
          {/* On a phone the rail is gone, so this is what opens it. */}
          <button
            type="button"
            className="shell__burger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MenuIcon />
          </button>
          <a href="/meetings" className="shell__logo" aria-label="Texor Talk"><Logo /></a>
        </div>

        <JoinBar onJoin={(code) => router.push(`/meetings/${code}`)} />

        <div className="shell__account">
          <button
            type="button"
            className="shell__icon-btn"
            aria-label="Settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon />
          </button>
          <AppsMenu />
          <AccountMenu user={user} />
        </div>
      </header>

      <div className="shell__body">
        <nav className={`rail ${menuOpen ? 'rail--open' : ''}`} aria-label="Sections">
          {destinations.map(({ href, label, icon }) => (
            <a
              key={href}
              href={href}
              className="rail__item"
              aria-current={pathname.startsWith(href) ? 'page' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              <span className="rail__icon">{icon}</span>
              <span className="rail__label">{label}</span>
            </a>
          ))}
        </nav>

        {/* Tapping away closes the rail on a phone, where it sits over content. */}
        {menuOpen ? (
          <button type="button" className="rail__scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
        ) : null}

        <main className="shell__main">
          {typeof children === 'function' ? children(user) : children}
        </main>
      </div>

      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

/**
 * Join by code, and start a new meeting.
 *
 * Both live in the top bar because they are the two things somebody opens this
 * product to do, and neither should depend on which page they happen to be on.
 */
function JoinBar({ onJoin }) {
  const [code, setCode] = useState('');
  const router = useRouter();
  const clean = code.trim().toLowerCase();

  return (
    <div className="shell__centre">
      <form
        className="joinbar"
        onSubmit={(event) => {
          event.preventDefault();
          if (clean) onJoin(clean);
        }}
      >
        <span className="joinbar__icon" aria-hidden="true"><KeypadGlyph /></span>
        <input
          className="joinbar__input"
          placeholder="Enter a code or link"
          aria-label="Meeting code or link"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <button type="submit" className="joinbar__go" disabled={!clean}>Join</button>
      </form>

      <button type="button" className="shell__new" onClick={() => router.push('/meetings?new=1')}>
        <VideoPlusIcon />
        <span>New</span>
      </button>
    </div>
  );
}

const KeypadGlyph = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
    <path d="M20 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm-9 3h2v2h-2V8Zm0 3h2v2h-2v-2ZM8 8h2v2H8V8Zm0 3h2v2H8v-2Zm-1 2H5v-2h2v2Zm0-3H5V8h2v2Zm9 7H8v-2h8v2Zm0-4h-2v-2h2v2Zm0-3h-2V8h2v2Zm3 3h-2v-2h2v2Zm0-3h-2V8h2v2Z" />
  </svg>
);

/**
 * The rest of the ecosystem, and the way to the account that unlocks it.
 *
 * One Texor Account carries somebody across every product, and a product that
 * gives them no way back to it — or across to its siblings — makes that account
 * feel like a login rather than the thing it is.
 */
function AppsMenu() {
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
    <div className="apps" ref={wrap}>
      <button
        type="button"
        className="shell__icon-btn"
        aria-label="Texor products"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Texor products"
        onClick={() => setOpen((was) => !was)}
      >
        <GridDotsIcon />
      </button>

      {open ? (
        <div className="apps__menu" role="menu">
          <p className="apps__head">Texor</p>
          <div className="apps__grid">
            {PRODUCTS.map((product) => (
              <a
                key={product.id}
                className={`apps__item ${product.current ? 'apps__item--current' : ''}`}
                href={product.href}
                role="menuitem"
                // Siblings open alongside rather than replacing a meeting that
                // might be in progress in this tab.
                target={product.current ? undefined : '_blank'}
                rel={product.current ? undefined : 'noreferrer'}
              >
                <span className="apps__mark" style={{ background: product.tint }}>
                  {product.initial}
                </span>
                <span className="apps__name">{product.name}</span>
                <span className="apps__blurb">{product.blurb}</span>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Identity, and the way out. */
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
      </button>

      {open ? (
        <div className="account__menu" role="menu">
          <div className="account__header">
            <Avatar user={user} />
            <div style={{ minWidth: 0 }}>
              <div className="account__name account__name--full">{user.displayName}</div>
              <div className="meta account__email">{user.email || 'Guest'}</div>
            </div>
          </div>
          <a
            className="account__item"
            role="menuitem"
            href={ACCOUNTS_ORIGIN}
            target="_blank"
            rel="noreferrer"
          >
            Manage your Texor Account
          </a>

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
    </div>
  );
}

export default AppShell;
