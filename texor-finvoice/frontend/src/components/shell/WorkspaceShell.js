'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Menu as MenuIcon, Plus, Search } from 'lucide-react';
import { Icon } from '@/components/Icon';
import { Alert, Button, ConfirmProvider, Loading, Menu, MenuItem, ToastProvider } from '@/components/ui';
import { api, auth } from '@/lib/api';
import { WorkspaceContext, screenFor, useWorkspaceValue } from '@/lib/workspace';
import { CommandPalette } from './CommandPalette';
import { Sidebar } from './Sidebar';

export function WorkspaceShell({ slug, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(undefined);
  const [boot, setBoot] = useState(null);
  const [error, setError] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await auth.me();
        if (cancelled) return;
        if (!me.user) { router.replace(`/signin?returnTo=${encodeURIComponent(pathname)}`); return; }
        setUser(me.user);
        const data = await api(`/api/w/${encodeURIComponent(slug)}`);
        if (!cancelled) setBoot(data);
      } catch (loadError) {
        if (cancelled) return;
        if (loadError.status === 404) router.replace('/workspaces');
        else setError(loadError.message);
      }
    })();
    return () => { cancelled = true; };
    // The pathname is only needed for the sign-in return address, on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, router]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setNavOpen(false), [pathname]);

  const value = useWorkspaceValue(slug, boot, setBoot, user);

  useEffect(() => {
    if (boot?.workspace?.branding?.accent) document.documentElement.style.setProperty('--ws-accent', boot.workspace.branding.accent);
  }, [boot?.workspace?.branding?.accent]);

  if (error) return <div className="auth-shell"><div style={{ maxWidth: 420 }}><Alert kind="error" title="Finvoice could not load this workspace">{error}</Alert></div></div>;
  if (!boot || !user) return <Loading label="Opening your workspace" />;

  const creatable = value.modules.filter((m) => ['records', 'documents'].includes(screenFor(m)) && value.can(m.key, 'create'));
  const fullBleed = /\/settings\/designs\/[^/]+$/.test(pathname);

  return (
    <WorkspaceContext.Provider value={value}>
      <ToastProvider>
        <ConfirmProvider>
          <div className={`app${navOpen ? ' nav-open' : ''}`}>
            <Sidebar onNavigate={() => setNavOpen(false)} />
            {navOpen ? <div className="scrim" onClick={() => setNavOpen(false)} /> : null}
            <div className="main">
              <header className="topbar print-hide">
                <Button variant="ghost" className="menu-toggle" icon={<MenuIcon />} aria-label="Open navigation" onClick={() => setNavOpen(true)} />
                <button type="button" className="search-trigger" onClick={() => setPalette(true)}>
                  <Search aria-hidden="true" /><span>Search or jump to…</span><span className="kbd">⌘K</span>
                </button>
                <div className="grow" />
                {creatable.length ? (
                  <Menu align="right" trigger={({ toggle }) => <Button icon={<Plus />} onClick={toggle}>New</Button>}>
                    {creatable.slice(0, 12).map((m) => (
                      <MenuItem key={m.key} href={value.href(`/${m.key}/new`)} icon={<Icon name={m.icon} />}>{m.labelSingular}</MenuItem>
                    ))}
                  </Menu>
                ) : null}
              </header>
              <main className={`content${fullBleed ? ' full' : ''}`}>{children}</main>
            </div>
          </div>
          <CommandPalette open={palette} onClose={() => setPalette(false)} />
        </ConfirmProvider>
      </ToastProvider>
    </WorkspaceContext.Provider>
  );
}
