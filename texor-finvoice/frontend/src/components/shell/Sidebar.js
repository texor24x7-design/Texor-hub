'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, UserRound } from 'lucide-react';
import { Icon } from '@/components/Icon';
import { Avatar, Menu, MenuItem } from '@/components/ui';
import { ACCOUNTS_ORIGIN, auth } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';

/**
 * Groups appear in the order of their earliest module, so an industry pack that
 * puts Job cards second sees its Operations group second — the sidebar follows
 * the business, not a fixed taxonomy.
 */
function groupModules(modules, groups) {
  const labels = new Map(groups.map((g) => [g.key, g.label]));
  const buckets = new Map();
  for (const m of modules) {
    if (m.page === false || m.locked) continue;
    const key = m.group || 'operations';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(m);
  }
  return [...buckets.entries()]
    .map(([key, items]) => ({ key, label: labels.get(key) ?? key, items: items.sort((a, b) => a.order - b.order) }))
    .sort((a, b) => (a.key === 'admin') - (b.key === 'admin') || a.items[0].order - b.items[0].order);
}

export function Sidebar({ onNavigate }) {
  const { boot, workspace, modules, href, user, member } = useWorkspace();
  const pathname = usePathname();
  const groups = groupModules(modules, boot.groups ?? []);
  const locked = modules.filter((m) => m.locked);

  const activeKey = (() => {
    const rest = pathname.replace(href(''), '').split('/').filter(Boolean);
    return rest[0] ?? 'dashboard';
  })();

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar-head">
        {/* The product's mark. Which business you are in is chosen from the
            topbar, next to New, where the actions are. */}
        <Link href={href('')} className="brand-home" aria-label="Finvoice home">
          <img src="/brand/finvoice-logo-dark.svg" alt="Finvoice" className="brand-mark" />
        </Link>
      </div>

      <nav className="sidebar-nav" onClick={(e) => { if (e.target.closest('a')) onNavigate?.(); }}>
        {groups.map((group) => (
          <div className="nav-group" key={group.key}>
            {group.label ? <div className="nav-group-label">{group.label}</div> : null}
            {group.items.map((m) => (
              <Link key={m.key} href={href(m.key === 'dashboard' ? '' : `/${m.key}`)} className={`nav-item${activeKey === m.key ? ' active' : ''}`} aria-current={activeKey === m.key ? 'page' : undefined}>
                <Icon name={m.icon} />
                <span className="ellipsis">{m.label}</span>
              </Link>
            ))}
          </div>
        ))}

        {locked.length ? (
          <div className="nav-group">
            <div className="nav-group-label">Finvoice Pro</div>
            {locked.map((m) => (
              <Link key={m.key} href={href(`/${m.key}`)} className={`nav-item locked${activeKey === m.key ? ' active' : ''}`}>
                <Icon name={m.icon} />
                <span className="ellipsis">{m.label}</span>
                <span className="pro-chip">PRO</span>
              </Link>
            ))}
          </div>
        ) : null}
      </nav>

      {workspace.edition !== 'pro' && member.role === 'owner' ? (
        <div className="edition-card">
          <strong>Finvoice Lite</strong>
          <p>Reports, GST filing, CRM, marketing and POS come with Pro.</p>
          <Link href={href('/settings/edition')} className="btn btn-sm btn-primary btn-block">Explore Pro</Link>
        </div>
      ) : null}

      <div className="sidebar-foot">
        <Menu up trigger={({ toggle }) => (
          <button type="button" className="user-chip" onClick={toggle}>
            <Avatar name={user?.displayName ?? member.name} src={user?.picture} />
            <span className="grow">
              <span className="ellipsis" style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 560 }}>{user?.displayName ?? member.name}</span>
              <span className="ellipsis" style={{ display: 'block', fontSize: '0.72rem', color: '#8ea39d' }}>{member.roleName}</span>
            </span>
          </button>
        )}>
          <div className="menu-label">{user?.email}</div>
          {ACCOUNTS_ORIGIN ? <MenuItem href={ACCOUNTS_ORIGIN} icon={<UserRound />}>Texor Account</MenuItem> : null}
          <MenuItem icon={<LogOut />} onClick={() => auth.logout()}>Sign out</MenuItem>
        </Menu>
      </div>
    </aside>
  );
}
