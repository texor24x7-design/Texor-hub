'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Archive, FileText, Pencil, Plus, Receipt, Share2, ShieldOff, Trash2 } from 'lucide-react';
import { Icon } from '@/components/Icon';
import { Alert, Badge, Button, ButtonLink, Dialog, Field, Menu, MenuItem, PageHeader, SkeletonRows, StatusBadge, useConfirm, useToast } from '@/components/ui';
import { FieldValue, readField } from '@/components/fields/FieldValue';
import { FieldInput } from '@/components/fields/FieldInput';
import { invalidate, useResource } from '@/lib/data';
import { date, dateTime, money } from '@/lib/format';
import { recordTitle, useWorkspace } from '@/lib/workspace';
import { Activity } from './Activity';
import { Statement } from './Statement';
import { StockDialog } from './StockDialog';
import { RecordForm } from './RecordForm';

const titleOf = (record, module) => recordTitle(module, record);

export function RecordCreate({ module }) {
  const { api, slug, href } = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const [opening, setOpening] = useState('');
  const prefill = params.get('customer') ? { customer: params.get('customer') } : null;
  const prefillRefs = prefill ? { [prefill.customer]: { title: params.get('customerName') ?? '' } } : {};

  return (
    <>
      <PageHeader title={`New ${module.labelSingular.toLowerCase()}`} crumbs={[{ label: module.label, href: href(`/${module.key}`) }, { label: 'New' }]} />
      <div style={{ maxWidth: 880 }}>
        <RecordForm
          module={module}
          record={prefill}
          refs={prefillRefs}
          submitLabel={`Create ${module.labelSingular.toLowerCase()}`}
          onCancel={() => router.back()}
          extra={module.key === 'products' ? (
            <section className="card"><div className="card-body">
              <Field label="Opening stock" hint="How many you have right now. Only used when stock tracking is on." htmlFor="opening">
                <input id="opening" className="input" type="number" step="any" style={{ maxWidth: 200 }} value={opening} onChange={(e) => setOpening(e.target.value)} />
              </Field>
            </div></section>
          ) : null}
          extraValues={module.key === 'products' && opening !== '' ? { openingStock: Number(opening) } : null}
          onSubmit={async (values) => {
            const { record } = await api.post(`/records/${module.key}`, values);
            invalidate(`records:${slug}:${module.key}`);
            invalidate(`dashboard:${slug}`);
            router.replace(href(`/${module.key}/${record._id}`));
          }}
        />
      </div>
    </>
  );
}

export function RecordEdit({ module, id }) {
  const { api, slug, href } = useWorkspace();
  const router = useRouter();
  const { data, error } = useResource(`record:${slug}:${module.key}:${id}`, () => api.get(`/records/${module.key}/${id}`));
  if (error) return <Alert kind="error">{error.message}</Alert>;
  if (!data) return <SkeletonRows />;
  return (
    <>
      <PageHeader title={`Edit ${titleOf(data.record)}`} crumbs={[{ label: module.label, href: href(`/${module.key}`) }, { label: titleOf(data.record), href: href(`/${module.key}/${id}`) }, { label: 'Edit' }]} />
      <div style={{ maxWidth: 880 }}>
        <RecordForm
          module={module}
          record={data.record}
          refs={data.refs}
          submitLabel="Save changes"
          onCancel={() => router.back()}
          onSubmit={async (values) => {
            await api.patch(`/records/${module.key}/${id}`, values);
            invalidate(`records:${slug}:${module.key}`);
            invalidate(`record:${slug}:${module.key}:${id}`);
            router.replace(href(`/${module.key}/${id}`));
          }}
        />
      </div>
    </>
  );
}

function FieldsCard({ module, record, refs }) {
  const { hidden } = useWorkspace();
  const roleHidden = hidden(module.key);
  const sections = new Map();
  for (const field of module.fields) {
    if (field.hidden || roleHidden.includes(field.key)) continue;
    const value = readField(field, record);
    if (field.type === 'checkbox' && !value) continue;
    const name = field.section || 'Details';
    if (!sections.has(name)) sections.set(name, []);
    sections.get(name).push(field);
  }
  return [...sections.entries()].map(([name, fields]) => (
    <section className="card" key={name}>
      <div className="card-header"><h2>{name}</h2></div>
      <div className="card-body fields-grid">
        {fields.map((f) => (
          <div key={f.key} className={['longtext', 'address', 'items', 'variants', 'image'].includes(f.type) ? 'full' : ''}>
            <div className="fv-label">{f.label}</div>
            <div className="fv-value"><FieldValue field={f} value={readField(f, record)} refs={refs} /></div>
          </div>
        ))}
      </div>
    </section>
  ));
}

function CustomerRelated({ id }) {
  const { api, slug, href, module, can, currency, modules } = useWorkspace();
  const invoices = module('invoices');
  const quotations = module('quotations');
  const { data } = useResource(`related:${slug}:customer:${id}`, async () => {
    const [inv, quo] = await Promise.all([
      invoices && can('invoices', 'view') ? api.get('/documents/invoices', { customer: id, limit: 8 }) : null,
      quotations && can('quotations', 'view') ? api.get('/documents/quotations', { customer: id, limit: 5 }) : null,
    ]);
    return { inv, quo };
  });
  const linked = modules.filter((m) => m.custom && m.customerLink && can(m.key, 'view'));

  return (
    <>
      {data?.inv ? (
        <section className="card">
          <div className="card-header"><h2>{invoices.label}</h2><span className="muted small num">{money(Math.max(data.inv.sums.totalMinor - data.inv.sums.paidMinor - (data.inv.sums.creditedMinor ?? 0), 0), currency)} owed</span></div>
          {data.inv.documents.length ? data.inv.documents.map((d) => (
            <Link key={d._id} className="list-row" href={href(`/invoices/${d._id}`)}>
              <span className="grow"><span className="strong">{d.number ?? 'Draft'}</span> <span className="subtle">· {date(d.date)}</span></span>
              <StatusBadge status={d.state} /><span className="num">{money(d.totals.totalMinor, currency)}</span>
            </Link>
          )) : <div className="list-row muted">Nothing billed yet.</div>}
          {can('invoices', 'create') ? <div className="card-footer"><ButtonLink size="sm" variant="secondary" href={href(`/invoices/new?customer=${id}`)} icon={<Plus />}>New {invoices.labelSingular.toLowerCase()}</ButtonLink></div> : null}
        </section>
      ) : null}
      {data?.quo?.documents.length ? (
        <section className="card">
          <div className="card-header"><h2>{quotations.label}</h2></div>
          {data.quo.documents.map((d) => (
            <Link key={d._id} className="list-row" href={href(`/quotations/${d._id}`)}>
              <span className="grow strong">{d.number}</span><StatusBadge status={d.state} /><span className="num">{money(d.totals.totalMinor, currency)}</span>
            </Link>
          ))}
        </section>
      ) : null}
      {linked.map((m) => <LinkedRecords key={m.key} module={m} customerId={id} />)}
    </>
  );
}

function LinkedRecords({ module, customerId }) {
  const { api, slug, href, can } = useWorkspace();
  const { data } = useResource(`records:${slug}:${module.key}:customer:${customerId}`, () => api.get(`/records/${module.key}`, { 'f.customer': customerId, limit: 10 }));
  return (
    <section className="card">
      <div className="card-header"><h2 className="row"><Icon name={module.icon} size={16} />{module.label}</h2></div>
      {data?.records.length ? data.records.map((r) => (
        <Link key={r._id} className="list-row" href={href(`/${module.key}/${r._id}`)}><span className="grow strong">{titleOf(r)}</span><span className="subtle tiny">{date(r.updatedAt)}</span></Link>
      )) : <div className="list-row muted">None yet.</div>}
      {can(module.key, 'create') ? <div className="card-footer"><ButtonLink size="sm" variant="secondary" href={href(`/${module.key}/new?customer=${customerId}`)} icon={<Plus />}>Add {module.labelSingular.toLowerCase()}</ButtonLink></div> : null}
    </section>
  );
}

function StockPanel({ item, onChanged }) {
  const { api, slug, can } = useWorkspace();
  const { data, reload } = useResource(`stock:${slug}:${item._id}`, () => api.get(`/products/${item._id}/stock`));
  const [open, setOpen] = useState(false);

  if (!item.trackStock) return null;
  const REASONS = { opening: 'Opening stock', sale: 'Sold', void: 'Invoice voided', adjustment: 'Adjustment', purchase: 'Stock received', return: 'Returned' };

  return (
    <section className="card">
      <div className="card-header">
        <div><h2>Stock</h2><div className="muted small">{item.stock} {item.unit} in hand{item.lowStock != null ? ` · alert at ${item.lowStock}` : ''}</div></div>
        {can('products', 'edit') ? <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Adjust</Button> : null}
      </div>
      {(data?.movements ?? []).slice(0, 8).map((m) => (
        <div className="list-row" key={m._id}>
          <span className="grow"><span>{REASONS[m.reason]}</span>{m.note ? <span className="subtle"> · {m.note}</span> : null}<div className="tiny subtle">{dateTime(m.createdAt)}</div></span>
          <span className={`num strong ${m.quantity > 0 ? 'delta-up' : 'delta-down'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</span>
          <span className="num subtle" style={{ width: 48, textAlign: 'right' }}>{m.balance}</span>
        </div>
      ))}
      <StockDialog item={item} open={open} onClose={() => setOpen(false)} onSaved={() => { reload(); onChanged(); }} />
    </section>
  );
}

function ClaimsPanel({ warranty, onChanged }) {
  const { api, can } = useWorkspace();
  const toast = useToast();
  const [issue, setIssue] = useState('');
  const [photo, setPhoto] = useState(null);
  const [adding, setAdding] = useState(false);
  const [resolving, setResolving] = useState(null);

  return (
    <section className="card">
      <div className="card-header"><h2>Claims</h2>{can('warranties', 'edit') && warranty.state !== 'void' ? <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setAdding(true)}>New claim</Button> : null}</div>
      {warranty.claims?.length ? [...warranty.claims].reverse().map((c) => (
        <div className="list-row" key={c._id} style={{ alignItems: 'flex-start' }}>
          <div className="grow stack-sm">
            <div className="row row-between"><span className="strong">{c.issue}</span><StatusBadge status={c.status} /></div>
            <div className="tiny subtle">Reported {dateTime(c.reportedAt)}</div>
            {c.resolution ? <div className="small muted">{c.resolution}</div> : null}
            {c.photos?.length ? <div className="row">{c.photos.map((p) => <img key={p} src={`${process.env.NEXT_PUBLIC_API_ORIGIN}/api/files/${p}`} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6 }} />)}</div> : null}
            {can('warranties', 'approve') && ['open', 'in_progress'].includes(c.status) ? <div><Button size="sm" variant="secondary" onClick={() => setResolving({ claim: c, status: 'resolved', resolution: '' })}>Update</Button></div> : null}
          </div>
        </div>
      )) : <div className="list-row muted">No claims on this warranty.</div>}

      <Dialog open={adding} onClose={() => setAdding(false)} title="Raise a claim" footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={async () => {
        try {
          const res = await api.post(`/warranties/${warranty._id}/claims`, { issue, photos: photo ? [photo] : [] });
          setAdding(false); setIssue(''); setPhoto(null); onChanged();
          toast(res.outOfWarranty ? 'Claim recorded — note this warranty has expired' : 'Claim recorded');
        } catch (error) { toast(error.message, 'error'); }
      }}>Save claim</Button></>}>
        <div className="stack">
          {warranty.state === 'expired' ? <Alert kind="warning">This warranty ended on {date(warranty.endDate)}. You can still record the claim.</Alert> : null}
          <Field label="What is wrong?" required><textarea className="input" rows={3} value={issue} onChange={(e) => setIssue(e.target.value)} autoFocus /></Field>
          <Field label="Photo"><FieldInput field={{ key: 'photo', type: 'image' }} moduleKey="warranties" value={photo} onChange={setPhoto} id="claim-photo" /></Field>
        </div>
      </Dialog>

      <Dialog open={Boolean(resolving)} onClose={() => setResolving(null)} title="Update claim" footer={<><Button variant="secondary" onClick={() => setResolving(null)}>Cancel</Button><Button onClick={async () => {
        try {
          await api.patch(`/warranties/${warranty._id}/claims/${resolving.claim._id}`, { status: resolving.status, resolution: resolving.resolution });
          setResolving(null); onChanged(); toast('Claim updated');
        } catch (error) { toast(error.message, 'error'); }
      }}>Save</Button></>}>
        {resolving ? (
          <div className="stack">
            <Field label="Status"><select className="input" value={resolving.status} onChange={(e) => setResolving({ ...resolving, status: e.target.value })}><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="rejected">Rejected</option></select></Field>
            <Field label="Resolution"><textarea className="input" rows={3} value={resolving.resolution} onChange={(e) => setResolving({ ...resolving, resolution: e.target.value })} placeholder="Replaced motor under warranty…" /></Field>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}

export function RecordDetail({ module, id }) {
  const { api, slug, href, can, module: moduleOf } = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const key = `record:${slug}:${module.key}:${id}`;
  const { data, error, reload } = useResource(key, () => api.get(`/records/${module.key}/${id}`));
  const [billing, setBilling] = useState(false);

  if (error) return <Alert kind="error" title={`Could not open this ${module.labelSingular.toLowerCase()}`}>{error.message}</Alert>;
  if (!data) return <SkeletonRows rows={8} />;
  const { record, refs } = data;
  const invoices = moduleOf('invoices');

  async function remove() {
    if (!(await confirm({ title: `Delete ${titleOf(record, module)}?`, message: `This ${module.labelSingular.toLowerCase()} will be removed from lists and search.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.del(`/records/${module.key}/${id}`);
      invalidate(`records:${slug}:${module.key}`);
      toast(`${module.labelSingular} deleted`);
      router.replace(href(`/${module.key}`));
    } catch (deleteError) { toast(deleteError.message, 'error'); }
  }

  async function bill() {
    setBilling(true);
    try {
      const { document } = await api.post(`/records/${module.key}/${id}/invoice`);
      invalidate(`documents:${slug}:invoices`);
      router.push(href(`/invoices/${document._id}/edit`));
    } catch (billError) {
      toast(billError.message, 'error');
      setBilling(false);
    }
  }

  async function share() {
    try {
      const { token } = await api.post(`/warranties/${id}/share`);
      const url = `${window.location.origin}/warranty/${token}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      window.open(url, '_blank', 'noopener');
      toast('Warranty card link copied');
    } catch (shareError) { toast(shareError.message, 'error'); }
  }

  async function voidWarranty() {
    if (!(await confirm({ title: 'Void this warranty?', message: 'It will stop accepting claims. This cannot be undone.', confirmLabel: 'Void warranty', danger: true }))) return;
    try { await api.post(`/warranties/${id}/void`); reload(); toast('Warranty voided'); } catch (voidError) { toast(voidError.message, 'error'); }
  }

  const badge = module.key === 'warranties' ? <StatusBadge status={record.state} />
    : module.boardField ? <Badge tone="brand" plain>{module.fields.find((f) => f.key === module.boardField)?.options?.find((o) => o.value === readField(module.fields.find((f) => f.key === module.boardField), record))?.label}</Badge>
      : null;

  return (
    <>
      <PageHeader
        title={titleOf(record, module)}
        badge={badge}
        crumbs={[{ label: module.label, href: href(`/${module.key}`) }, { label: titleOf(record, module) }]}
        description={module.customerLink && refs[record.customer] ? <>For <Link href={href(`/customers/${record.customer}`)}>{refs[record.customer].title}</Link></> : undefined}
        actions={(
          <>
            {module.toInvoice && invoices && can('invoices', 'create') ? (
              record.invoice
                ? <ButtonLink variant="secondary" href={href(`/invoices/${record.invoice}`)} icon={<Receipt />}>View {invoices.labelSingular.toLowerCase()}</ButtonLink>
                : <Button onClick={bill} loading={billing} icon={<Receipt />}>Create {invoices.labelSingular.toLowerCase()}</Button>
            ) : null}
            {module.key === 'customers' && invoices && can('invoices', 'create') ? <ButtonLink href={href(`/invoices/new?customer=${id}`)} icon={<FileText />}>New {invoices.labelSingular.toLowerCase()}</ButtonLink> : null}
            {module.key === 'warranties' ? <Button variant="secondary" icon={<Share2 />} onClick={share}>Warranty card</Button> : null}
            {can(module.key, 'edit') ? <ButtonLink variant="secondary" href={href(`/${module.key}/${id}/edit`)} icon={<Pencil />}>Edit</ButtonLink> : null}
            {(can(module.key, 'delete') || (module.key === 'warranties' && can('warranties', 'approve'))) ? (
              <Menu align="right" trigger={({ toggle }) => <Button variant="secondary" icon={<Archive />} aria-label="More" onClick={toggle} />}>
                {module.key === 'warranties' && record.state !== 'void' && can('warranties', 'approve') ? <MenuItem icon={<ShieldOff />} onClick={voidWarranty}>Void warranty</MenuItem> : null}
                {can(module.key, 'delete') ? <MenuItem icon={<Trash2 />} danger onClick={remove}>Delete</MenuItem> : null}
              </Menu>
            ) : null}
          </>
        )}
      />

      <div className="doc-layout">
        <div className="stack">
          {module.key === 'warranties' && record.invoice ? (
            <Alert kind="info">Issued automatically from invoice <Link href={href(`/invoices/${record.invoice}`)}>{record.invoiceNumber}</Link>. Covers {date(record.startDate)} to {date(record.endDate)}.</Alert>
          ) : null}
          <FieldsCard module={module} record={record} refs={refs} />
          {module.key === 'customers' ? <CustomerRelated id={id} /> : null}
          {module.key === 'customers' ? <Statement customerId={id} /> : null}
          {module.key === 'warranties' ? <ClaimsPanel warranty={record} onChanged={reload} /> : null}
        </div>
        <div className="doc-side">
          {module.key === 'customers' && record.receivableMinor ? (
            <section className="card card-pad"><div className="stat-label">Outstanding</div><div className="amount-lg">{money(record.receivableMinor)}</div></section>
          ) : null}
          {module.key === 'products' ? <StockPanel item={record} onChanged={reload} /> : null}
          <section className="card">
            <div className="card-header"><h2>Activity</h2><span className="tiny subtle">Created {date(record.createdAt)}</span></div>
            <Activity module={module.key} recordId={id} limit={12} />
          </section>
        </div>
      </div>
    </>
  );
}


