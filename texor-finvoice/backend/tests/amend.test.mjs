/**
 * Correcting an invoice after it has been issued — the owner's escape hatch.
 *
 * An issued invoice has already moved stock, raised warranties and put money on
 * the customer's account. The point of every check here is that changing one
 * moves all of them: an amendment that leaves the shelf, the ledger or the
 * balance describing the old invoice is worse than no amendment at all.
 */
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();
const owner = await seedUser(db, { texorId: 'tx-amd', email: 'amd@fix.test', displayName: 'Fix Owner' });
const manager = await seedUser(db, { texorId: 'tx-mgr', email: 'mgr@fix.test', displayName: 'Ann Admin' });

const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Fixit Electricals', industry: 'electronics', gstin: '27AAPFU0939F1ZV', sample: true } });
const W = `/api/w/${created.body.workspace.slug}`;
await call(owner, `${W}/team/invites`, { method: 'POST', body: { email: 'mgr@fix.test', role: 'admin' } });
await call(manager, '/api/workspaces');

const product = async (body) => (await call(owner, `${W}/records/products`, { method: 'POST', body: { taxRate: 18, priceIncludesTax: false, trackStock: true, trackSerials: false, ...body } })).body.record;
const tracked = await product({ name: 'Ceiling fan', priceMinor: 250000, openingStock: 40 });
const warranted = await product({ name: 'Water heater', priceMinor: 900000, openingStock: 20, warranty: { duration: 12, unit: 'months' } });
const customer = (await call(owner, `${W}/records/customers`, { method: 'POST', body: { name: 'Anil Kumar', phone: '9820000333', stateCode: '27' } })).body.record;
const second = (await call(owner, `${W}/records/customers`, { method: 'POST', body: { name: 'Someone Else', phone: '9820000444', stateCode: '27' } })).body.record;

const line = (quantity) => ({ item: tracked._id, description: tracked.name, quantity, priceMinor: tracked.priceMinor, taxRate: tracked.taxRate ?? 18, priceIncludesTax: tracked.priceIncludesTax ?? false });
const stockOf = async () => (await call(owner, `${W}/records/products/${tracked._id}`)).body.record.stock;
const owed = async (id = customer._id) => (await call(owner, `${W}/records/customers/${id}`)).body.record.receivableMinor;
const read = async (id) => (await call(owner, `${W}/documents/invoices/${id}`)).body.document;

async function issued(quantity, payments) {
  const draft = (await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: customer._id, lines: [line(quantity)] } })).body.document;
  const res = await call(owner, `${W}/documents/invoices/${draft._id}/issue`, { method: 'POST', body: payments ? { payments } : {} });
  return res.body.document;
}
const amend = (user, id, body) => call(user, `${W}/documents/invoices/${id}/amend`, { method: 'PATCH', body });

section('who may correct one');
{
  const invoice = await issued(1);
  const byAdmin = await amend(manager, invoice._id, { notes: 'Nice try' });
  check('an admin cannot amend an issued invoice', byAdmin.status === 403, byAdmin.body);
  check('and nothing about it changed', (await read(invoice._id)).notes !== 'Nice try');

  const plain = await call(manager, `${W}/documents/invoices/${invoice._id}`, { method: 'PATCH', body: { notes: 'Through the front door' } });
  check('the ordinary edit route still refuses everyone', plain.status === 409, plain.body);

  const byOwner = await amend(owner, invoice._id, { notes: 'Fixed the note' });
  check('the owner may', byOwner.status === 200 && byOwner.body.document.notes === 'Fixed the note', byOwner.body);
  check('and it is still the same invoice', byOwner.body.document.number === invoice.number && byOwner.body.document.status === 'issued', byOwner.body.document.number);
}

section('changing what was sold');
{
  const before = await stockOf();
  const owedBefore = await owed();
  const invoice = await issued(2);
  check('issuing took two off the shelf', (await stockOf()) === before - 2, { before, now: await stockOf() });

  const amended = await amend(owner, invoice._id, { lines: [line(5)] });
  check('the invoice is re-totalled', amended.body.document.totals.totalMinor > invoice.totals.totalMinor, { was: invoice.totals.totalMinor, now: amended.body.document.totals.totalMinor });
  check('the extra three come off the shelf too', (await stockOf()) === before - 5, { expected: before - 5, now: await stockOf() });
  check('and the customer owes the new figure', (await owed()) === owedBefore + amended.body.document.totals.totalMinor, { expected: owedBefore + amended.body.document.totals.totalMinor, now: await owed() });

  const back = await amend(owner, invoice._id, { lines: [line(1)] });
  check('taking lines off puts stock back', (await stockOf()) === before - 1, { expected: before - 1, now: await stockOf() });
  check('and lowers what is owed', (await owed()) === owedBefore + back.body.document.totals.totalMinor, await owed());

  const ledger = (await call(owner, `${W}/products/${tracked._id}/stock`)).body.movements;
  check('each correction is a row in the stock ledger', ledger.filter((m) => /Amended/.test(m.note ?? '')).length === 2, ledger.slice(0, 3).map((m) => m.note));

  const untouched = await amend(owner, invoice._id, { notes: 'Only the note moved' });
  const after = (await call(owner, `${W}/products/${tracked._id}/stock`)).body.movements;
  check('an edit that leaves the lines alone writes no stock row at all', after.length === ledger.length, { was: ledger.length, now: after.length });
  check('but still saves', untouched.body.document.notes === 'Only the note moved');
}

section('money already taken');
{
  const invoice = await issued(4);
  const total = invoice.totals.totalMinor;
  await call(owner, `${W}/documents/invoices/${invoice._id}/payments`, { method: 'POST', body: { payments: [{ mode: 'Cash', amountMinor: total }] } });
  check('it is paid', (await read(invoice._id)).status === 'paid');

  const tooSmall = await amend(owner, invoice._id, { lines: [line(1)] });
  check('it cannot be cut below what has been received', tooSmall.status === 409 && /already been received/i.test(tooSmall.body.error.message), tooSmall.body);
  check('so the invoice is untouched', (await read(invoice._id)).lines[0].quantity === 4);

  const bigger = await amend(owner, invoice._id, { lines: [line(6)] });
  check('but it can grow', bigger.status === 200, bigger.body);
  check('and goes back to part paid, because the money no longer covers it', bigger.body.document.status === 'partial', bigger.body.document.status);
  check('with the difference now owing', bigger.body.document.amountDueMinor === bigger.body.document.totals.totalMinor - total, bigger.body.document.amountDueMinor);
}

section('what stays put');
{
  const invoice = await issued(1);
  const moved = await amend(owner, invoice._id, { customer: second._id });
  check('the customer cannot be swapped', moved.status === 409 && /customer/i.test(moved.body.error.message), moved.body);

  const redated = await amend(owner, invoice._id, { date: '2026-01-01' });
  check('nor the date it was numbered under', redated.status === 409 && /date/i.test(redated.body.error.message), redated.body);

  const voided = await call(owner, `${W}/documents/invoices/${invoice._id}/void`, { method: 'POST', body: { reason: 'Test' } });
  check('the invoice voids', voided.status === 200, voided.body);
  const afterVoid = await amend(owner, invoice._id, { notes: 'Resurrect' });
  check('a void invoice can no longer be amended', afterVoid.status === 409, afterVoid.body);
}

section('warranties follow the lines');
{
  const wLine = (quantity) => ({ item: warranted._id, description: warranted.name, quantity, priceMinor: warranted.priceMinor, taxRate: warranted.taxRate ?? 18, priceIncludesTax: warranted.priceIncludesTax ?? false });
  const draft = (await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: customer._id, lines: [wLine(2)] } })).body.document;
  const invoice = (await call(owner, `${W}/documents/invoices/${draft._id}/issue`, { method: 'POST', body: {} })).body.document;

  const live = async () => (await call(owner, `${W}/records/warranties?limit=100`)).body.records.filter((w) => w.invoiceNumber === invoice.number && w.status === 'active');
  check('issuing raised a warranty per unit', (await live()).length === 2, (await live()).length);

  await call(owner, `${W}/documents/invoices/${invoice._id}/amend`, { method: 'PATCH', body: { lines: [wLine(3)] } });
  check('correcting the quantity reissues them to match', (await live()).length === 3, (await live()).length);
}

await finish();
