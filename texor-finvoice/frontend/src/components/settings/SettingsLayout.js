'use client';

import { useEffect, useRef } from 'react';
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
  const nav = useRef(null);
  // On a phone the menu is a sideways strip; bring the current section into view.
  useEffect(() => { nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [section]);
  return (
    <div className="side-layout">
      <nav ref={nav} className="card side-nav side-nav--sticky" aria-label="Settings">
        <div className="menu-label">Settings</div>
        {SECTIONS.map(({ key, label, icon: Glyph, href: to }) => (
          <Link key={key} href={href(to ?? `/settings/${key}`)} className={`menu-item${section === key ? ' active' : ''}`} aria-current={section === key ? 'page' : undefined}><Glyph />{label}</Link>
        ))}
      </nav>
      <div className="stack-lg">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>
          {actions ? <div className="row">{actions}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
