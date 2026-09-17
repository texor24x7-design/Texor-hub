/**
 * Every industry pack, start to finish: onboard with the sample catalogue, bill
 * something from it, issue it, render it in the pack's own design, and load the
 * pack's dashboard. A pack that references a field, module or widget that does
 * not exist fails here rather than in front of a new customer.
 */
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();
const owner = await seedUser(db, { texorId: 'tx-packs', email: 'packs@test.test', displayName: 'Pack Tester' });
const { body: { industries } } = await call(null, '/api/industries');

for (const pack of industries) {
  section(pack.name);
  const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: `${pack.name} Test`, industry: pack.key, gstin: '27AAPFU0939F1ZV', sample: true } });
  check('workspace is created', created.status === 201, created.body);
  const W = `/api/w/${created.body.workspace.slug}`;

  const boot = await call(owner, W);
  const sidebar = boot.body.modules.filter((m) => m.page !== false && !m.locked && m.enabled).map((m) => m.label);
  check(`sidebar matches the gallery preview (${sidebar.length} modules)`, pack.sidebar.every((m) => sidebar.includes(m.label)), [pack.sidebar.map((m) => m.label), sidebar]);

  for (const m of boot.body.modules.filter((x) => x.custom)) {
    const list = await call(owner, `${W}/records/${m.key}`);
    check(`${m.label} lists`, list.status === 200, list.body);
    if (m.boardField) check(`${m.label} board field has options`, (m.fields.find((f) => f.key === m.boardField)?.options ?? []).length > 1);
    for (const f of m.fields.filter((x) => x.type === 'reference')) check(`${m.label}.${f.key} links to a real module`, ['customers', 'items', 'products', 'services', 'staff', 'warranties'].includes(f.refModule) || boot.body.modules.some((x) => x.key === f.refModule), f.refModule);
  }

  const { body: { items } } = await call(owner, `${W}/items?limit=5`);
  const customer = await call(owner, `${W}/records/customers`, { method: 'POST', body: { name: 'Sample Customer', phone: '9820012345', custom: {} } });
  check('a customer can be added with the pack\'s required fields', customer.status === 201, customer.body);

  const item = items[0];
  const lines = item
    ? [{ item: item._id, description: item.name, variant: item.variants?.[0]?.name ?? '', quantity: 1, priceMinor: item.variants?.[0]?.priceMinor ?? item.priceMinor, taxRate: item.taxRate, priceIncludesTax: item.priceIncludesTax, hsn: item.hsn, serials: item.trackSerials ? ['PACK-SN-1'] : [] }]
    : [{ description: 'Consulting', quantity: 1, priceMinor: 100000, taxRate: 18 }];
  const invoice = await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: customer.body.record?._id, lines } });
  check('an invoice drafts from the sample catalogue', invoice.status === 201, invoice.body);
  const issued = await call(owner, `${W}/documents/invoices/${invoice.body.document?._id}/issue`, { method: 'POST' });
  check('and issues', issued.body.document?.status === 'issued', issued.body);

  const html = await call(owner, `${W}/documents/invoices/${invoice.body.document?._id}/html`);
  check(`it renders in the pack's ${boot.body.workspace.preferences.design} design`, html.status === 200 && String(html.body).includes(issued.body.document?.number), String(html.body).slice(0, 200));

  const dash = await call(owner, `${W}/dashboard`);
  const wanted = boot.body.workspace.preferences.dashboard;
  check('every dashboard widget the pack asks for exists', dash.status === 200 && wanted.every((k) => dash.body.available.includes(k)), [wanted, dash.body.available]);
}

await finish();
