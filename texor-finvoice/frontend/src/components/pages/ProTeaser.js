'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import { Icon } from '@/components/Icon';
import { useWorkspace } from '@/lib/workspace';

export function ProTeaser({ module }) {
  const { member, href, modules } = useWorkspace();
  const pro = modules.filter((m) => m.edition === 'pro');
  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      <div className="hero" style={{ padding: '2rem' }}>
        <span className="pro-chip">FINVOICE PRO</span>
        <h1 className="row" style={{ marginTop: 12 }}><Icon name={module.icon} size={26} />{module.label}</h1>
        <p style={{ marginTop: 8, fontSize: '1rem', maxWidth: 560 }}>{module.teaser}</p>
      </div>
      <section className="card">
        <div className="card-header"><h2>Everything Pro adds</h2></div>
        <div className="card-body grid-2">
          {pro.map((m) => (
            <div key={m.key} className="row row-top">
              <span className="empty-icon" style={{ width: 34, height: 34, borderRadius: 9 }}><Icon name={m.icon} size={17} /></span>
              <div><div className="strong">{m.label}</div><div className="small muted">{m.teaser}</div></div>
            </div>
          ))}
        </div>
        <div className="card-footer row row-between wrap">
          <span className="small muted row"><Check size={15} color="var(--success)" />Your Lite data carries straight over — nothing to migrate.</span>
          {member.role === 'owner' ? <Link className="btn btn-primary" href={href('/settings/edition')}>Switch to Pro</Link> : <span className="small muted">Ask the workspace owner to switch.</span>}
        </div>
      </section>
    </div>
  );
}
