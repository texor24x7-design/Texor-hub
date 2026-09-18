'use client';

/**
 * What a customer sees when they open an invoice or quotation from WhatsApp or
 * email: the document itself, a PDF download and, while money is owed, a UPI
 * payment button that opens their UPI app on a phone.
 */
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { CreditCard, Download, IndianRupee, Printer, Share2 } from 'lucide-react';
import { Alert, Badge, Loading } from '@/components/ui';
import { API_ORIGIN, api, fileUrl } from '@/lib/api';
import { money } from '@/lib/format';
import { upiLink } from '@/lib/shared/render.mjs';

export default function PublicDocument({ params }) {
  const { token } = use(params);
  const [data, setData] = useState(null);
  const [html, setHtml] = useState('');
  const [error, setError] = useState(null);
  const [height, setHeight] = useState(1200);
  const frame = useRef(null);

  useEffect(() => {
    api(`/api/public/documents/${token}`).then(setData).catch((e) => setError(e.message));
    fetch(`${API_ORIGIN}/api/public/documents/${token}/html`).then((r) => (r.ok ? r.text() : '')).then(setHtml).catch(() => {});
  }, [token]);

  const fit = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (doc?.body) setHeight(doc.documentElement.scrollHeight + 16);
  }, []);

  if (error) return <div className="auth-shell"><div style={{ maxWidth: 420 }}><Alert title="This link is not available">{error}</Alert></div></div>;
  if (!data) return <Loading label="Opening document" />;

  const { document: doc, business, kind, module } = data;
  const due = kind === 'invoices' ? doc.amountDueMinor : 0;
  const pay = due > 0 ? upiLink({ upiId: business.bank?.upiId, payee: business.legalName || business.name, amountMinor: due, reference: doc.number, currency: doc.currency }) : null;
  const title = `${module.labelSingular} ${doc.number ?? ''} from ${business.name}`;

  return (
    <div className="public">
      <header className="public-bar print-hide">
        <div className="row">
          {business.branding?.logo ? <img src={fileUrl(business.branding.logo)} alt="" style={{ height: 32, maxWidth: 120, objectFit: 'contain' }} /> : null}
          <div><div className="strong">{business.name}</div><div className="tiny subtle">{module.labelSingular} {doc.number} · {money(doc.totals.totalMinor, doc.currency)}</div></div>
          {doc.state === 'paid' ? <Badge tone="green">Paid</Badge> : doc.state === 'overdue' ? <Badge tone="red">Overdue</Badge> : null}
        </div>
        <div className="row wrap">
          {doc.payUrl ? <a className="btn btn-primary" href={doc.payUrl} target="_blank" rel="noreferrer"><CreditCard />Pay {money(due, doc.currency)} online</a> : null}
          {pay ? <a className={`btn ${doc.payUrl ? 'btn-secondary' : 'btn-primary'}`} href={pay}><IndianRupee />Pay {money(due, doc.currency)} by UPI</a> : null}
          <a className="btn btn-secondary" href={`${API_ORIGIN}/api/public/documents/${token}/pdf?download=1`}><Download />Download PDF</a>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Print" onClick={() => frame.current?.contentWindow?.print()}><Printer /></button>
          {typeof navigator !== 'undefined' && navigator.share ? <button type="button" className="btn btn-ghost btn-icon" aria-label="Share" onClick={() => navigator.share({ title, url: window.location.href }).catch(() => {})}><Share2 /></button> : null}
        </div>
      </header>
      {html ? <iframe ref={frame} title={title} className="public-frame" srcDoc={html} sandbox="allow-same-origin allow-modals" style={{ height }} onLoad={() => { fit(); setTimeout(fit, 500); }} /> : <Loading label="Rendering" />}
      <p className="center tiny subtle print-hide" style={{ padding: '1rem' }}>Sent with <a href="https://finvoice.texor.app">Texor Finvoice</a></p>
    </div>
  );
}
