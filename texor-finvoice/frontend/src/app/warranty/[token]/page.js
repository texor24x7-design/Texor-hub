'use client';

import { use, useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, ShieldX } from 'lucide-react';
import { Alert, Loading } from '@/components/ui';
import { api, fileUrl } from '@/lib/api';
import { date } from '@/lib/format';

const SCOPE_LABELS = {
  parts_labour: 'Parts & labour', parts: 'Parts only', labour: 'Labour only',
  replacement: 'Replacement', service: 'Service / workmanship',
};

export default function WarrantyCard({ params }) {
  const { token } = use(params);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api(`/api/public/warranties/${token}`).then(setData).catch((e) => setError(e.message)); }, [token]);

  if (error) return <div className="auth-shell"><div style={{ maxWidth: 420 }}><Alert title="This link is not available">{error}</Alert></div></div>;
  if (!data) return <Loading label="Opening warranty" />;
  const { warranty: w, business } = data;
  const Glyph = w.state === 'active' ? ShieldCheck : w.state === 'void' ? ShieldOff : ShieldX;
  const accent = business.accent ?? '#12a57f';
  const remaining = Math.ceil((new Date(w.endDate) - Date.now()) / 864e5);

  return (
    <div className="auth-shell">
      <main className="auth-card" style={{ maxWidth: '28rem', padding: 0, overflow: 'hidden' }}>
        <div style={{ background: `linear-gradient(135deg, ${accent}, #0c1916)`, color: '#fff', padding: '1.5rem' }}>
          <div className="row row-between">
            {business.logo ? <img src={fileUrl(business.logo)} alt="" style={{ height: 36, background: '#fff', borderRadius: 8, padding: 4 }} /> : <strong>{business.name}</strong>}
            <Glyph size={28} />
          </div>
          <div style={{ marginTop: '1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.8 }}>{business.label} card</div>
          <h1 style={{ color: '#fff', marginTop: 4 }}>{w.itemName}</h1>
          {w.serial ? <div className="mono" style={{ opacity: 0.9, marginTop: 4 }}>S/N {w.serial}</div> : null}
        </div>
        <div className="card-body stack">
          <div className="row row-between">
            <span className={`badge ${w.state === 'active' ? 'badge-green' : w.state === 'void' ? 'badge-neutral' : 'badge-red'}`}>{w.state === 'active' ? 'Active' : w.state === 'void' ? 'Void' : 'Expired'}</span>
            {w.state === 'active' ? <span className="small muted">{remaining} days left</span> : null}
          </div>
          <dl className="kv">
            <dt>Registered to</dt><dd>{w.customer}</dd>
            <dt>Valid from</dt><dd>{date(w.startDate)}</dd>
            <dt>Valid until</dt><dd>{date(w.endDate)}</dd>
            {w.scope ? <><dt>Cover</dt><dd>{SCOPE_LABELS[w.scope] ?? w.scope}</dd></> : null}
            <dt>Transferable</dt><dd>{w.transferable ? 'Yes, with proof of purchase' : 'No — covers the original buyer'}</dd>
            {w.invoiceNumber ? <><dt>Invoice</dt><dd className="mono">{w.invoiceNumber}</dd></> : null}
            {w.claims.length ? <><dt>Claims</dt><dd>{w.claims.length}</dd></> : null}
          </dl>
          {w.includes?.length ? (
            <div><div className="section-title">What is covered</div><ul className="points-list" style={{ marginTop: 6 }}>{w.includes.map((point, i) => <li key={i}>{point}</li>)}</ul></div>
          ) : null}
          {w.excludes?.length ? (
            <div><div className="section-title">What is not covered</div><ul className="points-list" style={{ marginTop: 6 }}>{w.excludes.map((point, i) => <li key={i}>{point}</li>)}</ul></div>
          ) : null}
          {w.coverage ? <div><div className="section-title">Notes</div><p className="small" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{w.coverage}</p></div> : null}
          <div className="divider" />
          <div className="small muted">To make a claim, contact {business.name}{business.phone ? <> on <a href={`tel:${business.phone}`}>{business.phone}</a></> : null}{business.email ? <> or <a href={`mailto:${business.email}`}>{business.email}</a></> : null}.</div>
        </div>
      </main>
    </div>
  );
}
