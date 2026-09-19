'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Avatar, Loading, Logo } from '@/components/ui';
import {
  ArchiveIcon, GridDotsIcon, LabelIcon, MenuIcon, NotesIcon, PeopleIcon, PlusIcon,
  SearchIcon, SettingsIcon, TrashIcon,
} from '@/components/icons';
import { auth } from '@/lib/api';
import { ACCOUNTS_ORIGIN, PRODUCTS } from '@/lib/ecosystem';

/**
 * Chrome for every signed-in Texor Notes page.
 *
 * A rail down the side rather than links across the top, as in every other
 * product here — with a handful of destinations that never grow, a rail keeps
 * them all visible and always in the same place. The top bar belongs to the one
 * thing people come to a notes app to do that navigation cannot help with:
 * find something they wrote.
 */
export function AppShell({ children, labels = null }) {
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

  if (user === undefined) return <Loading label="Loading Texor Notes" />;

  /**
   * The sidebar.
   *
   * Four places, and every one of them is a real screen. Labels live underneath
   * rather than in here, because a person's labels are their own and a fixed
   * rail is the wrong shape for a list that grows.
   */
  const destinations = [
    { href: '/notes', label: 'Notes', icon: <NotesIcon /> },
    { href: '/shared', label: 'Shared with me', icon: <PeopleIcon /> },
    { href: '/archive', label: 'Archive', icon: <ArchiveIcon /> },
    { href: '/trash', label: 'Trash', icon: <TrashIcon /> },
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

          <a
            href="/settings/api"
            className={`side__item ${pathname.startsWith('/settings') ? 'side__item--on' : ''}`}
            onClick={() => setMenuOpen(false)}
          >
            <span className="side__icon"><SettingsIcon /></span>
            <span>Settings</span>
          </a>
        </nav>

        {/* A person's own labels, under the fixed four. */}
        {labels ? (
          <div className="side__labels">{labels}</div>
        ) : null}
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

          <SearchBar />

          <div className="topbar__right">
            <AppsMenu />
            <AccountMenu user={user} />
          </div>
        </header>

        <main className="shell__main">
          {typeof children === 'function' ? children(user) : children}
        </main>
      </div>
    </div>
  );
}

/**
 * Find something, and write something.
 *
 * The two things somebody opens a notes app to do, in the one place that is on
 * every screen. Search submits to /notes rather than filtering in place, so the
 * result is a page with an address somebody can keep or send.
 */
function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState('');

  return (
    <div className="shell__centre">
      <form
        className="joinbar"
        onSubmit={(event) => {
          event.preventDefault();
          router.push(q.trim() ? `/notes?q=${encodeURIComponent(q.trim())}` : '/notes');
        }}
      >
        <span className="joinbar__icon" aria-hidden="true"><SearchIcon /></span>
        <input
          id="notes-search"
          className="joinbar__input"
          placeholder="Search your notes"
          aria-label="Search your notes"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        {q.trim() ? <button type="submit" className="joinbar__go">Search</button> : null}
      </form>

      <button type="button" className="shell__new" onClick={() => router.push('/notes?new=1')}>
        <PlusIcon />
        <span>New note</span>
      </button>
    </div>
  );
}


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
              <div className="meta account__email">{user.email}</div>
            </div>
          </div>
          {/*
            * `ACCOUNTS_ORIGIN` is empty when a deployment has not configured
            * it, and an empty href is a link to the current page — so the link
            * is drawn only when there is somewhere for it to go.
            */}
          {ACCOUNTS_ORIGIN ? (
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
