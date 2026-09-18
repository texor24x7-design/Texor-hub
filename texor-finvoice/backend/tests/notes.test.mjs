/**
 * Credit and debit notes: their own numbering, what they do to the customer's
 * balance, to the invoice they belong to, and to stock.
 */
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();
const owner = await seedUser(db, { texorId: 'tx-note', email: 'note@volt.test', displayName: 'Note Owner' });
const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Note Electronics', industry: 'electronics', gstin: '27AAPFU0939F1ZV', sample: true } });
const W = `/api/w/${created.body.workspace.slug}`;

// A plainly stocked product: serials would need a real one back for each return.
const made = await call(owner, `${W}/records/products`, { method: 'POST', body: { name: 'Mini fridge 45L', priceMinor: 2649000, taxRate: 18, trackStock: true, trackSerials: false, openingStock: 10, hsn: '8418', priceIncludesTax: false } });
const fridge = made.body.record;
const customer = await call(owner, `${W}/records/customers`, { method: 'POST', body: { name: 'Ravi Kumar', phone: '9820000021', stateCode: '27' } });
const customerId = customer.body.record._id;

const stockOf = async (id) => (await call(owner, `${W}/records/products/${id}`)).body.record.stock;
const receivable = async () => (await call(owner, `${W}/records/customers/${customerId}`)).body.record.receivableMinor;
const invoiceOf = async (id) => (await call(owner, `${W}/documents/invoices/${id}`)).body.document;

const openingStock = await stockOf(fridge._id);
const draft = await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: customerId, date: new Date().toISOString().slice(0, 10), lines: [{ item: fridge._id, description: 'Mini fridge 45L', quantity: 2, priceMinor: 2649000, taxRate: 18 }] } });
const invoiceId = draft.body.document._id;
const issued = await call(owner, `${W}/documents/invoices/${invoiceId}/issue`, { method: 'POST' });
const invoiceTotal = issued.body.document.totals.totalMinor;

section('raising a credit note from an invoice');
{
  const made = await call(owner, `${W}/documents/invoices/${invoiceId}/note/credit_notes`, { method: 'POST' });
  check('a credit note can be drafted from an issued invoice', made.status === 201, made.body);
  check('it copies the invoice lines', made.body.document.lines.length === 1 && made.body.document.lines[0].quantity === 2, made.body.document.lines);
  check('and remembers which invoice it answers', made.body.document.invoiceNumber === issued.body.document.number, made.body.document);
  check('as a draft, with no number yet', made.body.document.status === 'draft' && !made.body.document.number, made.body.document);

  const notes = await call(owner, `${W}/documents/credit_notes`);
  check('it shows in the credit notes list', notes.body.total === 1, notes.body);
  const debits = await call(owner, `${W}/documents/debit_notes`);
  check('and not among the debit notes', debits.body.total === 0, debits.body);
}

section('a partial credit note');
{
  const list = await call(owner, `${W}/documents/credit_notes`);
  const noteId = list.body.documents[0]._id;
  // Send one fridge back, not both.
  await call(owner, `${W}/documents/credit_notes/${noteId}`, { method: 'PATCH', body: { lines: [{ item: fridge._id, description: 'Mini fridge returned', quantity: 1, priceMinor: 2649000, taxRate: 18 }] } });

  const before = await receivable();
  const stockBefore = await stockOf(fridge._id);
  const done = await call(owner, `${W}/documents/credit_notes/${noteId}/issue-note`, { method: 'POST' });
  check('it issues with its own number series', done.status === 200 && done.body.document.number?.startsWith('CN/'), done.body.document?.number ?? done.body);

  const note = done.body.document;
  check('the customer owes less by the value of the note', (await receivable()) === before - note.totals.totalMinor, { before, after: await receivable(), note: note.totals.totalMinor });
  check('the returned fridge is back on the shelf', (await stockOf(fridge._id)) === stockBefore + 1, { stockBefore, now: await stockOf(fridge._id) });

  const invoice = await invoiceOf(invoiceId);
  check('the invoice records what has been credited', invoice.creditedMinor === note.totals.totalMinor, invoice.creditedMinor);
  check('and now shows less still due', invoice.amountDueMinor === invoiceTotal - note.totals.totalMinor, invoice.amountDueMinor);
}

section('a credit note cannot exceed the invoice');
{
  const made = await call(owner, `${W}/documents/invoices/${invoiceId}/note/credit_notes`, { method: 'POST' });
  const tooMuch = await call(owner, `${W}/documents/credit_notes/${made.body.document._id}/issue-note`, { method: 'POST' });
  check('crediting the whole invoice again is refused', tooMuch.status === 400 && /still carries/i.test(JSON.stringify(tooMuch.body)), tooMuch.body);
  await call(owner, `${W}/documents/credit_notes/${made.body.document._id}`, { method: 'DELETE' });
}

section('paying what is left');
{
  const invoice = await invoiceOf(invoiceId);
  const over = await call(owner, `${W}/documents/invoices/${invoiceId}/payments`, { method: 'POST', body: { amountMinor: invoice.amountDueMinor + 1, mode: 'UPI' } });
  check('a payment bigger than the credited balance is refused', over.status === 400, over.body);

  const paid = await call(owner, `${W}/documents/invoices/${invoiceId}/payments`, { method: 'POST', body: { amountMinor: invoice.amountDueMinor, mode: 'UPI' } });
  check('paying exactly the credited balance settles it', paid.status === 201, paid.body);
  const after = await invoiceOf(invoiceId);
  check('and the invoice reads as paid', after.status === 'paid', after.status);
  check('with nothing owing', after.amountDueMinor === 0, after.amountDueMinor);
}

section('a debit note pushes the balance the other way');
{
  const second = await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: customerId, date: new Date().toISOString().slice(0, 10), lines: [{ item: fridge._id, description: 'Mini fridge 45L', quantity: 1, priceMinor: 2649000, taxRate: 18 }] } });
  const id = second.body.document._id;
  await call(owner, `${W}/documents/invoices/${id}/issue`, { method: 'POST' });

  const made = await call(owner, `${W}/documents/invoices/${id}/note/debit_notes`, { method: 'POST' });
  await call(owner, `${W}/documents/debit_notes/${made.body.document._id}`, { method: 'PATCH', body: { lines: [{ description: 'Undercharged delivery', quantity: 1, priceMinor: 50000, taxRate: 18 }] } });

  const before = await receivable();
  const done = await call(owner, `${W}/documents/debit_notes/${made.body.document._id}/issue-note`, { method: 'POST' });
  check('a debit note issues on its own series', done.body.document.number?.startsWith('DN/'), done.body.document?.number);
  check('and the customer owes more', (await receivable()) === before + done.body.document.totals.totalMinor, { before, after: await receivable() });
  const invoice = await invoiceOf(id);
  check('the invoice it belongs to owes more too', invoice.amountDueMinor > invoice.totals.totalMinor, { due: invoice.amountDueMinor, total: invoice.totals.totalMinor });
}

section('a note against a void invoice');
{
  const third = await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: customerId, date: new Date().toISOString().slice(0, 10), lines: [{ item: fridge._id, description: 'Mini fridge 45L', quantity: 1, priceMinor: 2649000, taxRate: 18 }] } });
  const id = third.body.document._id;
  await call(owner, `${W}/documents/invoices/${id}/issue`, { method: 'POST' });
  const made = await call(owner, `${W}/documents/invoices/${id}/note/credit_notes`, { method: 'POST' });
  await call(owner, `${W}/documents/invoices/${id}/void`, { method: 'POST', body: { reason: 'raised twice' } });
  const refused = await call(owner, `${W}/documents/credit_notes/${made.body.document._id}/issue-note`, { method: 'POST' });
  check('is refused, because voiding already reversed it', refused.status === 409, refused.body);
}

section('the public copy');
{
  const list = await call(owner, `${W}/documents/credit_notes?state=issued`);
  const note = list.body.documents[0];
  const pub = await call(null, `/api/public/documents/${(await call(owner, `${W}/documents/credit_notes/${note._id}`)).body.document.publicToken}`);
  check('a customer can open the credit note without signing in', pub.status === 200 && pub.body.document.number === note.number, pub.body?.document?.number);
}

await finish();
