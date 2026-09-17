/**
 * The sales cycle end to end: quote → invoice → issue → pay → void, and the
 * side effects each step must have (or refuse to have) on numbers, stock,
 * warranties and what the customer owes.
 */
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();

const owner = await seedUser(db, { texorId: 'tx-dev', email: 'dev@volt.test', displayName: 'Dev Owner' });
const seller = await seedUser(db, { texorId: 'tx-sam', email: 'sam@volt.test', displayName: 'Sam Seller' });
const other = await seedUser(db, { texorId: 'tx-oth', email: 'oth@volt.test', displayName: 'Other Seller' });

const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Volt Electronics', industry: 'electronics', gstin: '27AAPFU0939F1ZV', sample: true } });
const W = `/api/w/${created.body.workspace.slug}`;
await call(owner, `${W}/team/invites`, { method: 'POST', body: { email: 'sam@volt.test', role: 'sales' } });
await call(owner, `${W}/team/invites`, { method: 'POST', body: { email: 'oth@volt.test', role: 'sales' } });
await call(seller, '/api/workspaces');
await call(other, '/api/workspaces');

const { body: { items } } = await call(owner, `${W}/items?limit=50`);
const tv = items.find((i) => i.name.includes('LED TV'));
const install = items.find((i) => i.name === 'Wall-mount TV installation');

const local = await call(owner, `${W}/records/customers`, { method: 'POST', body: { name: 'Priya Nair', phone: '9820000002', stateCode: '27' } });
const karnataka = await call(owner, `${W}/records/customers`, { method: 'POST', body: { name: 'Bengaluru Hotels Pvt Ltd', gstin: '29AAGCB7383J1Z4' } });
check('a GSTIN customer is set to their state and marked a business', karnataka.body.record?.stateCode === '29' && karnataka.body.record.kind === 'business', karnataka.body);

const tvLine = (serials = []) => ({ item: tv._id, description: tv.name, hsn: tv.hsn, quantity: 2, unit: 'Pcs', priceMinor: tv.priceMinor, taxRate: 18, priceIncludesTax: true, serials });
const installLine = { item: install._id, description: install.name, quantity: 2, priceMinor: install.priceMinor, taxRate: 18 };

section('quotation');
let quote;
{
  const empty = await call(seller, `${W}/documents/quotations`, { method: 'POST', body: { customer: karnataka.body.record._id, lines: [] } });
  check('a quotation needs a line', empty.status === 400 && empty.body.error.details.some((d) => d.field === 'lines'));

  const res = await call(seller, `${W}/documents/quotations`, { method: 'POST', body: { customer: karnataka.body.record._id, lines: [tvLine(), installLine] } });
  check('sales drafts a quotation', res.status === 201, res.body);
  quote = res.body.document;
  check('quotations are numbered straight away, in the financial-year series', /^QT\/\d{2}-\d{2}\/0001$/.test(quote.number), quote.number);
  check('a Karnataka customer from Maharashtra is charged IGST', quote.interState === true && quote.totals.igstMinor > 0 && quote.totals.cgstMinor === 0);
  check('inclusive TV prices still total exactly', quote.lines[0].totalMinor === 2 * tv.priceMinor);
  check('the validity date defaults from the date', Boolean(quote.validUntil));

  const peer = await call(other, `${W}/documents/quotations/${quote._id}`);
  check("an 'own records' salesperson cannot open a colleague's quotation", peer.status === 404);
  const peerList = await call(other, `${W}/documents/quotations`);
  check('nor see it listed', peerList.body.total === 0);
  const ownerList = await call(owner, `${W}/documents/quotations`);
  check('the owner sees everyone\'s', ownerList.body.total === 1);

  const sent = await call(seller, `${W}/documents/quotations/${quote._id}/send`, { method: 'POST' });
  check('it is marked sent', sent.body.document?.status === 'sent', sent.body);
  const accepted = await call(seller, `${W}/documents/quotations/${quote._id}/accept`, { method: 'POST' });
  check('and accepted', accepted.body.document?.status === 'accepted');
}

section('conversion');
let invoice;
{
  const converted = await call(seller, `${W}/documents/quotations/${quote._id}/convert`, { method: 'POST' });
  check('the quotation becomes a draft invoice', converted.status === 201 && converted.body.document.status === 'draft', converted.body);
  invoice = converted.body.document;
  check('a draft invoice has no number yet', invoice.number === null);
  check('it carries the quotation number as its reference', invoice.reference === quote.number);
  const again = await call(seller, `${W}/documents/quotations/${quote._id}/convert`, { method: 'POST' });
  check('a quotation converts only once', again.status === 409);
  const deleteQuote = await call(owner, `${W}/documents/quotations/${quote._id}`, { method: 'DELETE' });
  check('a converted quotation cannot be deleted', deleteQuote.status === 409);
}

section('issuing');
{
  const withoutSerials = await call(seller, `${W}/documents/invoices/${invoice._id}/issue`, { method: 'POST' });
  check('a serial-tracked product needs its serial numbers first', withoutSerials.status === 400 && withoutSerials.body.error.details.some((d) => d.field === 'lines.0.serials'), withoutSerials.body);

  const dupe = await call(seller, `${W}/documents/invoices/${invoice._id}`, { method: 'PATCH', body: { lines: [tvLine(['SN-1', 'SN-1']), installLine] } });
  check('the draft can still be edited', dupe.status === 200);
  const dupeIssue = await call(seller, `${W}/documents/invoices/${invoice._id}/issue`, { method: 'POST' });
  check('the same serial twice is refused', dupeIssue.status === 400);

  await call(seller, `${W}/documents/invoices/${invoice._id}`, { method: 'PATCH', body: { lines: [tvLine(['SN-1001', 'SN-1002']), installLine] } });
  const issued = await call(seller, `${W}/documents/invoices/${invoice._id}/issue`, { method: 'POST' });
  check('the invoice is issued', issued.body.document?.status === 'issued', issued.body);
  invoice = issued.body.document;
  check('it gets the first number in the series', /^INV\/\d{2}-\d{2}\/0001$/.test(invoice.number), invoice.number);
  check('the number fits the GST 16-character limit', invoice.number.length <= 16);
  check('the seller is frozen onto it', invoice.seller.gstin === '27AAPFU0939F1ZV');
  check('it has a public link token', Boolean(invoice.publicToken));

  const tvAfter = await call(owner, `${W}/records/products/${tv._id}`);
  check('two TVs left the stock', tvAfter.body.record.stock === tv.stock - 2, [tv.stock, tvAfter.body.record.stock]);

  const warranties = await call(owner, `${W}/records/warranties?q=sn-100`);
  check('a warranty was registered for each serial', warranties.body.total === 2, warranties.body.total);
  check('covering one year less a day', (() => { const w = warranties.body.records[0]; const days = (new Date(w.endDate) - new Date(w.startDate)) / 864e5; return days >= 363 && days <= 365; })());

  const customer = await call(owner, `${W}/records/customers/${karnataka.body.record._id}`);
  check("the customer's balance now includes the invoice", customer.body.record.receivableMinor === invoice.totals.totalMinor);

  const quoteAfter = await call(owner, `${W}/documents/quotations/${quote._id}`);
  check('the quotation links to its invoice', quoteAfter.body.related.invoice?.number === invoice.number);

  const edit = await call(seller, `${W}/documents/invoices/${invoice._id}`, { method: 'PATCH', body: { lines: [installLine] } });
  check('an issued invoice refuses changes to its lines', edit.status === 409, edit.body);
  const due = await call(seller, `${W}/documents/invoices/${invoice._id}`, { method: 'PATCH', body: { dueDate: new Date(Date.now() - 3 * 864e5).toISOString() } });
  check('but its due date can move', due.status === 200, due.body);
  check('and a past due date with money owing reads as overdue', due.body.document.state === 'overdue');
  const overdue = await call(owner, `${W}/documents/invoices?state=overdue`);
  check('the overdue filter — dead in the old build — finds it', overdue.body.total === 1);

  const draftDelete = await call(owner, `${W}/documents/invoices/${invoice._id}`, { method: 'DELETE' });
  check('an issued invoice cannot be deleted', draftDelete.status === 409);

  // A second invoice trying to sell the same TV.
  const resale = await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: local.body.record._id, lines: [{ ...tvLine(['SN-1002']), quantity: 1 }] } });
  const resaleIssue = await call(owner, `${W}/documents/invoices/${resale.body.document._id}/issue`, { method: 'POST' });
  check('a serial number that was already sold cannot be sold again', resaleIssue.status === 409 && resaleIssue.body.error.message.includes(invoice.number), resaleIssue.body);
}

section('public link');
{
  const pub = await call(null, `/api/public/documents/${invoice.publicToken}`);
  check('the customer can open the invoice without signing in', pub.status === 200 && pub.body.document.number === invoice.number, pub.body);
  check('without internal fields', !('createdBy' in pub.body.document) && !('searchText' in pub.body.document));
  check('with the business details to print', pub.body.business.gstin === '27AAPFU0939F1ZV');
  const bogus = await call(null, '/api/public/documents/not-a-real-token-at-all-000');
  check('a made-up token is 404', bogus.status === 404);
}

section('payments');
{
  const total = invoice.totals.totalMinor;
  const badMode = await call(seller, `${W}/documents/invoices/${invoice._id}/payments`, { method: 'POST', body: { amountMinor: 1000, mode: 'Bitcoin' } });
  check('an unknown payment mode is refused', badMode.status === 400);

  const over = await call(seller, `${W}/documents/invoices/${invoice._id}/payments`, { method: 'POST', body: { amountMinor: total + 1, mode: 'UPI' } });
  check('paying more than is owed is refused', over.status === 400, over.body);

  const part = await call(seller, `${W}/documents/invoices/${invoice._id}/payments`, { method: 'POST', body: { amountMinor: 1000000, mode: 'UPI', reference: 'UTR123' } });
  check('a part payment makes the invoice partial', part.status === 201 && part.body.invoice.status === 'partial', part.body);

  // Two cashiers settle the remainder at the same moment; only one may succeed.
  const rest = total - 1000000;
  const [a, b] = await Promise.all([
    call(seller, `${W}/documents/invoices/${invoice._id}/payments`, { method: 'POST', body: { amountMinor: rest, mode: 'Cash' } }),
    call(owner, `${W}/documents/invoices/${invoice._id}/payments`, { method: 'POST', body: { amountMinor: rest, mode: 'Card' } }),
  ]);
  const statuses = [a.status, b.status].sort();
  check('racing payments cannot overpay', statuses[0] === 201 && statuses[1] >= 400, statuses);

  const paid = await call(owner, `${W}/documents/invoices/${invoice._id}`);
  check('the invoice is paid in full', paid.body.document.status === 'paid' && paid.body.document.amountDueMinor === 0, paid.body.document.status);
  check('and no longer overdue', paid.body.document.state === 'paid');
  const customer = await call(owner, `${W}/records/customers/${karnataka.body.record._id}`);
  check('the customer owes nothing', customer.body.record.receivableMinor === 0, customer.body.record.receivableMinor);

  const byMode = await call(owner, `${W}/payments`);
  check('payments are summarised by mode', byMode.body.byMode.some((m) => m.mode === 'UPI' && m.amountMinor === 1000000));

  const voidPaid = await call(owner, `${W}/documents/invoices/${invoice._id}/void`, { method: 'POST', body: { reason: 'Wrong customer' } });
  check('a paid invoice cannot be voided while payments stand', voidPaid.status === 409);

  const staffDelete = await call(seller, `/api/w/${created.body.workspace.slug}/payments/${part.body.payment._id}`, { method: 'DELETE' });
  check('sales cannot delete a payment', staffDelete.status === 403);

  for (const p of paid.body.related.payments) await call(owner, `${W}/payments/${p._id}`, { method: 'DELETE' });
  const unpaid = await call(owner, `${W}/documents/invoices/${invoice._id}`);
  check('removing the payments returns it to issued', unpaid.body.document.status === 'issued' && unpaid.body.document.amountPaidMinor === 0);
}

section('voiding');
{
  const before = (await call(owner, `${W}/records/products/${tv._id}`)).body.record.stock;
  const voided = await call(owner, `${W}/documents/invoices/${invoice._id}/void`, { method: 'POST', body: { reason: 'Customer cancelled' } });
  check('the invoice is voided', voided.body.document?.status === 'void', voided.body);
  const after = (await call(owner, `${W}/records/products/${tv._id}`)).body.record.stock;
  check('the TVs go back into stock', after === before + 2, [before, after]);
  const warranties = await call(owner, `${W}/records/warranties?state=void`);
  check('its warranties are voided', warranties.body.total === 2);
  const customer = await call(owner, `${W}/records/customers/${karnataka.body.record._id}`);
  check('and the balance is reversed', customer.body.record.receivableMinor === 0);

  const next = await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: local.body.record._id, lines: [installLine] } });
  const nextIssued = await call(owner, `${W}/documents/invoices/${next.body.document._id}/issue`, { method: 'POST' });
  check('the next invoice continues the sequence; voiding never frees a number', nextIssued.body.document?.number?.endsWith('/0002'), nextIssued.body.document?.number);
  check('a Maharashtra customer pays CGST + SGST', nextIssued.body.document.totals.cgstMinor > 0 && nextIssued.body.document.totals.igstMinor === 0);
}

section('invoice from a job card');
{
  const car = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Sparkle Wash', industry: 'car_wash', gstin: '27AAPFU0939F1ZV', sample: true } });
  const C = `/api/w/${car.body.workspace.slug}`;
  const { body: { items: washes } } = await call(owner, `${C}/items?q=foam`);
  const customer = await call(owner, `${C}/records/customers`, { method: 'POST', body: { name: 'Arjun' } });
  const vehicle = await call(owner, `${C}/records/c_vehicles`, { method: 'POST', body: { customer: customer.body.record._id, custom: { regNo: 'MH14 XY 9090', vehicleType: 'suv' } } });
  // The picker copies the catalogue default price onto the job card, exactly as the form does.
  const job = await call(owner, `${C}/records/c_job_cards`, { method: 'POST', body: { customer: customer.body.record._id, custom: { vehicle: vehicle.body.record._id, work: [{ item: washes[0]._id, description: washes[0].name, quantity: 1, priceMinor: washes[0].priceMinor }] } } });
  const bill = await call(owner, `${C}/records/c_job_cards/${job.body.record._id}/invoice`, { method: 'POST' });
  check('a job card becomes a draft invoice', bill.status === 201, bill.body);
  const suvPrice = washes[0].variants.find((v) => v.name === 'SUV').priceMinor;
  check('priced at the SUV variant because the vehicle is an SUV', bill.body.document?.lines[0].priceMinor === suvPrice && bill.body.document.lines[0].variant === 'SUV', bill.body.document?.lines[0]);
  check('with the vehicle number on the invoice', bill.body.document?.custom.vehicleNo === 'MH14 XY 9090');
  check("and the car wash pack's tax-inclusive pricing, so the SUV wash bills at its menu price", bill.body.document?.lines[0].priceIncludesTax === true && bill.body.document.totals.totalMinor === suvPrice, bill.body.document?.totals);
  const newService = await call(owner, `${C}/records/services`, { method: 'POST', body: { name: 'Headlight restoration', priceMinor: 99900 } });
  check('a new service picks up the workspace tax defaults', newService.body.record?.priceIncludesTax === true && newService.body.record.taxRate === 18, newService.body.record);
  const twice = await call(owner, `${C}/records/c_job_cards/${job.body.record._id}/invoice`, { method: 'POST' });
  check('a job card is billed once', twice.status === 409);
  const gstFree = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Unregistered Wash', industry: 'car_wash', sample: true } });
  const U = `/api/w/${gstFree.body.workspace.slug}`;
  const uc = await call(owner, `${U}/records/customers`, { method: 'POST', body: { name: 'Walk-in' } });
  const ui = await call(owner, `${U}/documents/invoices`, { method: 'POST', body: { customer: uc.body.record._id, lines: [{ description: 'Foam wash', quantity: 1, priceMinor: 30000, taxRate: 18 }] } });
  check('a business without a GSTIN charges no GST', ui.body.document?.totals.taxMinor === 0 && ui.body.document.totals.totalMinor === 30000, ui.body.document?.totals);
}

await finish();
