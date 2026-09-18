'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Avatar, Loading, Logo } from '@/components/ui';
import {
  CalendarIcon, ChatIcon, GridDotsIcon, GridIcon, HomeIcon, MenuIcon, NotesIcon, PeopleIcon,
  RecordIcon, SettingsIcon, ShieldIcon, VideoPlusIcon,
} from '@/components/icons';
import { SettingsDialog } from '@/components/SettingsDialog';
import { StartMeetingDialog, defaultMeetingTitle } from '@/components/StartMeetingDialog';
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
  const [startOpen, setStartOpen] = useState(false);
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

  /**
   * The sidebar.
   *
   * Four of these have no feature behind them yet and go to a page that says
   * so. They are here because the product's design calls for them and a
   * navigation that appears later is a navigation that moves under people —
   * but a link that 404s would be worse than either, so none of them do.
   */
  const destinations = [
    { href: '/home', label: 'Home', icon: <HomeIcon /> },
    { href: '/meetings', label: 'Meetings', icon: <CalendarIcon /> },
    { href: '/notes', label: 'Notes', icon: <NotesIcon /> },
    { href: '/channels', label: 'Channels', icon: <ChatIcon /> },
    { href: '/calendar', label: 'Calendar', icon: <CalendarIcon /> },
    { href: '/recordings', label: 'Recordings', icon: <RecordIcon /> },
    { href: '/contacts', label: 'Contacts', icon: <PeopleIcon /> },
    { href: '/integrations', label: 'Integrations', icon: <GridIcon /> },
    ...(user.isAdmin ? [{ href: '/admin', label: 'Admin', icon: <ShieldIcon /> }] : []),
  ];

  return (
    <div className="shell">
      <aside className={`side ${menuOpen ? 'side--open' : ''}`}>
        <a href="/home" className="side__brand" aria-label="Texor Talk"><Logo /></a>

        <nav className="side__nav" aria-label="Sections">
          {destinations.map(({ href, label, icon }) => {
            const on = pathname === href || (href !== '/home' && pathname.startsWith(href));
            return (
              <a
                key={href}
                href={href}
                className={`side__item ${on ? 'side__item--on' : ''}`}
                aria-current={on ? 'page' : undefined}
                onClick={() => setMenuOpen(false)}
              >
                <span className="side__icon">{icon}</span>
                <span>{label}</span>
              </a>
            );
          })}

          <button type="button" className="side__item" onClick={() => setSettingsOpen(true)}>
            <span className="side__icon"><SettingsIcon /></span>
            <span>Settings</span>
          </button>
        </nav>
      </aside>

      {menuOpen ? (
        <button type="button" className="side__scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
      ) : null}

      <div className="shell__body">
        <header className="topbar">
          <button
            type="button"
            className="topbar__burger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MenuIcon />
          </button>

          <JoinBar
            onJoin={(code) => router.push(`/meetings/${code}`)}
            onNew={() => setStartOpen(true)}
          />

          <div className="topbar__right">
            <AppsMenu />
            <AccountMenu user={user} />
          </div>
        </header>

        <main className="shell__main">
          {typeof children === 'function' ? children(user) : children}
        </main>
      </div>

      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}

      {/* In the shell rather than on a page: "New" is in the top bar of every
          screen, and it should open the same dialog from all of them. */}
      {startOpen ? (
        <StartMeetingDialog
          defaultTitle={defaultMeetingTitle(user)}
          onClose={() => setStartOpen(false)}
          onStarted={(meeting) => { setStartOpen(false); router.push(`/meetings/${meeting.code}`); }}
        />
      ) : null}
    </div>
  );
}

/**
 * Join by code, and start a new meeting.
 *
 * Both live in the top bar because they are the two things somebody opens this
 * product to do, and neither should depend on which page they happen to be on.
 */
function JoinBar({ onJoin, onNew }) {
  const [code, setCode] = useState('');
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
          id="joinbar-code"
          className="joinbar__input"
          placeholder="Enter a code or link"
          aria-label="Meeting code or link"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <button type="submit" className="joinbar__go" disabled={!clean}>Join</button>
      </form>

      <button type="button" className="shell__new" onClick={onNew}>
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
                {product.icon
                  ? <img className="apps__mark apps__mark--logo" src={product.icon} alt="" />
                  : <span className="apps__mark" style={{ background: product.tint }}>{product.initial}</span>}
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
          {/*
            * A guest has no Texor Account, so neither of these means what it
            * says for them: there is nothing to manage, and nothing to sign out
            * of. Offering them anyway sent guests to an identity provider that
            * had never heard of them.
            *
            * `ACCOUNTS_ORIGIN` is empty when a deployment has not configured
            * it, and an empty href is a link to the current page — so the link
            * is drawn only when there is somewhere for it to go.
            */}
          {!user.isGuest && ACCOUNTS_ORIGIN ? (
            <a
              className="account__item"
              role="menuitem"
              href={ACCOUNTS_ORIGIN}
              target="_blank"
              rel="noreferrer"
            >
              Manage your Texor Account
            </a>
          ) : null}

          {user.isGuest ? (
            <p className="account__note">
              You joined as a guest. Nothing here is saved to an account.
            </p>
          ) : null}

          <button
            type="button"
            className="account__item account__item--danger"
            role="menuitem"
            onClick={() => auth.logout()}
          >
            {user.isGuest ? 'Leave as guest' : 'Sign out'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default AppShell;
