'use client';

import Link from 'next/link';
import { Building2, History, LayoutGrid, Mail, Palette, Plug, ReceiptText, Rocket, Stamp, Users } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace';

export const SECTIONS = [
  { key: 'business', label: 'Business profile', icon: Building2 },
  { key: 'branding', label: 'Logo & signature', icon: Stamp },
  { key: 'preferences', label: 'Invoicing & taxes', icon: ReceiptText },
  { key: 'modules', label: 'Modules & fields', icon: LayoutGrid },
  { key: 'designs', label: 'Document designs', icon: Palette },
  { key: 'messages', label: 'Message templates', icon: Mail },
  { key: 'integrations', label: 'Integrations', icon: Plug },
  { key: 'team', label: 'Team & roles', icon: Users, href: '/team' },
  { key: 'edition', label: 'Lite & Pro', icon: Rocket },
  { key: 'activity', label: 'Activity log', icon: History },
];

export function SettingsLayout({ section, title, description, children, actions }) {
  const { href } = useWorkspace();
  return (
    <div className="grid-4" style={{ gridTemplateColumns: '220px minmax(0, 1fr)', alignItems: 'start', gap: '1.5rem' }}>
      <nav className="card" style={{ padding: '0.4rem', position: 'sticky', top: 'calc(var(--topbar-h) + 1rem)' }} aria-label="Settings">
        <div className="menu-label">Settings</div>
        {SECTIONS.map(({ key, label, icon: Glyph, href: to }) => (
          <Link key={key} href={href(to ?? `/settings/${key}`)} className={`menu-item${section === key ? ' active' : ''}`} aria-current={section === key ? 'page' : undefined}><Glyph />{label}</Link>
        ))}
      </nav>
      <div className="stack-lg" style={{ minWidth: 0 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>
          {actions ? <div className="row">{actions}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
