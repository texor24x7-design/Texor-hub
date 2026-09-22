/**
 * The counter sale: a bill raised and settled in one act.
 *
 * Issuing and taking the money is one request because it is one moment at the
 * till — and because the alternative, two requests from a browser, leaves an
 * issued-but-unpaid invoice behind every time the second one fails. The check
 * that matters most here is the rollback: a tender that does not fit must leave
 * the invoice a draft, not a numbered bill with half the money against it.
 */
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();
const owner = await seedUser(db, { texorId: 'tx-till', email: 'till@shop.test', displayName: 'Till Owner' });
const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Kirana Corner', industry: 'retail', gstin: '27AAPFU0939F1ZV', sample: true } });
const W = `/api/w/${created.body.workspace.slug}`;

const { body: { items } } = await call(owner, `${W}/items?limit=50`);
const thing = items.find((i) => i.kind === 'product') ?? items[0];
const customer = (await call(owner, `${W}/records/customers`, { method: 'POST', body: { name: 'Walk-in', phone: '9820000111', stateCode: '27' } })).body.record;

const line = { item: thing._id, description: thing.name, quantity: 2, priceMinor: thing.priceMinor, taxRate: thing.taxRate ?? 0, priceIncludesTax: thing.priceIncludesTax ?? false };
const draft = async () => (await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: customer._id, lines: [line] } })).body.document;
const issue = (id, payments) => call(owner, `${W}/documents/invoices/${id}/issue`, { method: 'POST', body: payments ? { payments } : {} });
const read = async (id) => (await call(owner, `${W}/documents/invoices/${id}`)).body.document;

section('paid at the counter');
{
  const invoice = await draft();
  const total = invoice.totals.totalMinor;
  const issued = await issue(invoice._id, [{ mode: 'Cash', amountMinor: total }]);
  check('the invoice is issued and paid in one request', issued.body.document?.status === 'paid', issued.body);
  check('and nothing is left owing', issued.body.document.amountDueMinor === 0, issued.body.document);

  const payments = await call(owner, `${W}/payments`);
  check('the money is on the books', payments.body.payments[0]?.amountMinor === total && payments.body.payments[0].mode === 'Cash', payments.body.payments?.[0]);
  const account = await call(owner, `${W}/records/customers/${customer._id}`);
  check('and the customer owes nothing', account.body.record.receivableMinor === 0, account.body.record.receivableMinor);
}

section('half cash, half UPI');
{
  const invoice = await draft();
  const total = invoice.totals.totalMinor;
  const half = Math.round(total / 2);
  const issued = await issue(invoice._id, [{ mode: 'Cash', amountMinor: half }, { mode: 'UPI', amountMinor: total - half }]);
  check('a split settles the invoice', issued.body.document?.status === 'paid', issued.body);

  const payments = (await call(owner, `${W}/payments`)).body;
  const mine = payments.payments.filter((p) => p.invoice === invoice._id);
  check('each mode is its own payment', mine.length === 2 && mine.some((p) => p.mode === 'Cash') && mine.some((p) => p.mode === 'UPI'), mine.map((p) => p.mode));
  check('so the by-mode totals stay true', payments.byMode.find((m) => m.mode === 'UPI')?.amountMinor === total - half, payments.byMode);
  check('and both point at the invoice number', mine.every((p) => p.invoiceNumber === issued.body.document.number), mine.map((p) => p.invoiceNumber));
}

section('a tender that does not fit');
{
  const invoice = await draft();
  const total = invoice.totals.totalMinor;
  const refused = await issue(invoice._id, [{ mode: 'Cash', amountMinor: total }, { mode: 'UPI', amountMinor: 100 }]);
  check('paying more than the total is refused', refused.status === 400, refused.body);

  // The whole point of doing this in one transaction.
  const after = await read(invoice._id);
  check('the invoice is still a draft', after.status === 'draft' && after.number === null, { status: after.status, number: after.number });
  check('it took no money on the way through', after.amountPaidMinor === 0, after.amountPaidMinor);
  const stray = (await call(owner, `${W}/payments`)).body.payments.filter((p) => p.invoice === invoice._id);
  check('and left no payment behind', stray.length === 0, stray);
}

section('part paid, rest on credit');
{
  const invoice = await draft();
  const total = invoice.totals.totalMinor;
  const issued = await issue(invoice._id, [{ mode: 'UPI', amountMinor: 5000 }]);
  check('a part payment leaves the invoice partial', issued.body.document?.status === 'partial', issued.body.document?.status);
  check('and the rest still owing', issued.body.document.amountDueMinor === total - 5000, issued.body.document.amountDueMinor);

  const settled = await call(owner, `${W}/documents/invoices/${invoice._id}/payments`, { method: 'POST', body: { payments: [{ mode: 'Cash', amountMinor: total - 5000 }] } });
  check('the balance can be taken later, as a list of one', settled.body.invoice?.status === 'paid', settled.body.invoice?.status);
  check('and the response still names the payment it made', Boolean(settled.body.payment?._id) && settled.body.payments.length === 1, settled.body.payments?.length);
}

section('issued on credit');
{
  const invoice = await draft();
  const issued = await issue(invoice._id);
  check('no payment means a plain issued invoice', issued.body.document?.status === 'issued', issued.body.document?.status);
  check('with a due date from the workspace default', Boolean(issued.body.document.dueDate), issued.body.document.dueDate);

  const dated = await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: customer._id, lines: [line], dueDate: '2026-12-31' } });
  const withDue = await issue(dated.body.document._id);
  check('a due date chosen in the editor is kept', withDue.body.document.dueDate?.startsWith('2026-12-31'), withDue.body.document.dueDate);
}

section('who may take money');
{
  const role = await call(owner, `${W}/team/roles`, { method: 'POST', body: {
    name: 'Biller',
    permissions: { invoices: { actions: ['view', 'create', 'edit', 'approve'], scope: 'all' }, customers: { actions: ['view'], scope: 'all' }, products: { actions: ['view'], scope: 'all' }, payments: { actions: ['view'], scope: 'all' } },
  } });
  check('a role that bills but cannot take money can be made', role.status === 201, role.body);

  const biller = await seedUser(db, { texorId: 'tx-bill', email: 'bill@shop.test', displayName: 'Bill Only' });
  await call(owner, `${W}/team/invites`, { method: 'POST', body: { email: 'bill@shop.test', role: role.body.role.key } });
  await call(biller, '/api/workspaces');

  const invoice = await draft();
  const refused = await call(biller, `${W}/documents/invoices/${invoice._id}/issue`, { method: 'POST', body: { payments: [{ mode: 'Cash', amountMinor: 100 }] } });
  check('and cannot slip a payment in through issuing', refused.status === 403, refused.body);
  check('the invoice it tried on is untouched', (await read(invoice._id)).status === 'draft');

  const plain = await call(biller, `${W}/documents/invoices/${invoice._id}/issue`, { method: 'POST', body: {} });
  check('but it can still issue on credit', plain.body.document?.status === 'issued', plain.body);
}

await finish();
