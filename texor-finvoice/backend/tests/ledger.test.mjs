/**
 * The customer ledger: a statement that balances, aging that buckets by how
 * late the money is, and expenses as a plain record module.
 */
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();
const { bucketsFor } = await import('../src/services/ledger.service.js');

const owner = await seedUser(db, { texorId: 'tx-led', email: 'led@volt.test', displayName: 'Ledger Owner' });
const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Ledger Co', industry: 'general', gstin: '27AAPFU0939F1ZV', sample: true } });
const W = `/api/w/${created.body.workspace.slug}`;

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const customer = await call(owner, `${W}/records/customers`, { method: 'POST', body: { name: 'Ledger Client', phone: '9820000051', stateCode: '27' } });
const customerId = customer.body.record._id;

const raise = async (amountMinor, dateOffset, dueOffset) => {
  const draft = await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: customerId, date: day(dateOffset), dueDate: day(dueOffset), lines: [{ description: 'Consulting', quantity: 1, priceMinor: amountMinor, taxRate: 0 }] } });
  const issued = await call(owner, `${W}/documents/invoices/${draft.body.document._id}/issue`, { method: 'POST' });
  return issued.body.document;
};

section('aging buckets');
{
  const asOf = new Date('2026-06-30T12:00:00Z');
  const inv = (dueDays, due) => ({ dueDate: new Date(asOf.getTime() - dueDays * 86400000), totals: { totalMinor: due }, amountPaidMinor: 0, creditedMinor: 0 });
  const b = bucketsFor([inv(-5, 1000), inv(10, 2000), inv(45, 3000), inv(75, 4000), inv(200, 5000)], asOf);
  check('money not yet due sits in current', b.current === 1000, b);
  check('ten days late lands in 0–30', b.d30 === 2000, b);
  check('forty-five days late lands in 31–60', b.d60 === 3000, b);
  check('seventy-five days late lands in 61–90', b.d90 === 4000, b);
  check('two hundred days late is older', b.older === 5000, b);
  check('and the buckets add up', b.totalMinor === 15000, b);

  const paid = bucketsFor([{ dueDate: new Date(asOf), totals: { totalMinor: 5000 }, amountPaidMinor: 5000, creditedMinor: 0 }], asOf);
  check('a settled invoice is in no bucket', paid.totalMinor === 0, paid);
  const credited = bucketsFor([{ dueDate: new Date(asOf), totals: { totalMinor: 5000 }, amountPaidMinor: 0, creditedMinor: 5000 }], asOf);
  check('nor is one wiped out by a credit note', credited.totalMinor === 0, credited);
}

section('a statement that balances');
{
  const first = await raise(100000, -40, -25);
  await raise(50000, -10, 20);
  await call(owner, `${W}/documents/invoices/${first._id}/payments`, { method: 'POST', body: { amountMinor: 30000, mode: 'Cash', date: day(-20) } });

  const note = await call(owner, `${W}/documents/invoices/${first._id}/note/credit_notes`, { method: 'POST' });
  await call(owner, `${W}/documents/credit_notes/${note.body.document._id}`, { method: 'PATCH', body: { date: day(-5), lines: [{ description: 'Agreed discount', quantity: 1, priceMinor: 20000, taxRate: 0 }] } });
  await call(owner, `${W}/documents/credit_notes/${note.body.document._id}/issue-note`, { method: 'POST' });

  const res = await call(owner, `${W}/customers/${customerId}/statement?from=${day(-60)}&to=${day(1)}`);
  check('the statement opens', res.status === 200, res.body);
  const s = res.body;
  check('every movement is listed', s.rows.length === 4, s.rows.map((r) => `${r.kind} ${r.debitMinor || -r.creditMinor}`));
  check('invoices are debits and payments are credits',
    s.rows.filter((r) => r.kind === 'invoice').every((r) => r.debitMinor > 0) && s.rows.filter((r) => r.kind === 'payment').every((r) => r.creditMinor > 0), s.rows);
  check('a credit note is a credit', s.rows.find((r) => r.kind === 'credit_note')?.creditMinor === 20000, s.rows);

  const expected = 100000 + 50000 - 30000 - 20000;
  check('the closing balance is what is owed', s.closingMinor === expected, { closing: s.closingMinor, expected });
  check('and the running balance ends there too', s.rows.at(-1).balanceMinor === expected, s.rows.at(-1));
  check('debits and credits are totalled', s.totals.debitMinor === 150000 && s.totals.creditMinor === 50000, s.totals);
  check('it agrees with the receivable we keep on the customer',
    s.closingMinor === (await call(owner, `${W}/records/customers/${customerId}`)).body.record.receivableMinor, s.closingMinor);
  check('and it carries the aging', s.aging.totalMinor === expected, s.aging);
}

section('a window that starts late');
{
  const res = await call(owner, `${W}/customers/${customerId}/statement?from=${day(-8)}&to=${day(1)}`);
  check('what happened before it becomes the opening balance', res.body.openingMinor === 120000, res.body.openingMinor);
  check('only the movements inside it are listed', res.body.rows.length === 1, res.body.rows);
  check('and the closing balance still lands in the same place', res.body.closingMinor === 100000, res.body.closingMinor);
}

section('the statement as a file');
{
  const res = await call(owner, `${W}/customers/${customerId}/statement/export?from=${day(-60)}&to=${day(1)}`, { raw: true });
  const text = await res.text();
  check('it downloads as CSV', res.headers.get('content-type')?.includes('text/csv'), res.headers.get('content-type'));
  check('with an opening and a closing line', /Opening balance/.test(text) && /Closing balance/.test(text), text.slice(0, 200));
  check('and a row per movement', text.trim().split('\n').length === 1 + 1 + 4 + 1, text.trim().split('\n').length);
}

section('expenses');
{
  const made = await call(owner, `${W}/records/expenses`, { method: 'POST', body: { description: 'Diesel for the generator', date: day(-2), amountMinor: 250000, category: 'Utilities', vendor: 'HP Petrol Pump', mode: 'Cash' } });
  check('an expense can be recorded', made.status === 201, made.body);
  const list = await call(owner, `${W}/records/expenses`);
  check('and shows in the list', list.body.total === 1, list.body);
  const prefs = await call(owner, `${W}/`);
  check('its category joins the list for next time', prefs.body.workspace.preferences.categories?.expenses?.includes('Utilities'), prefs.body.workspace.preferences.categories);
  const csv = await call(owner, `${W}/records/expenses/export`, { raw: true });
  check('expenses export like any other module', csv.status === 200);
}

section('the totals on a customer\u2019s invoice list');
{
  const res = await call(owner, `${W}/documents/invoices?customer=${customerId}&limit=10`);
  // An aggregation does no Mongoose casting, so a filter built from a string
  // customer id used to match nothing and quietly report zero owed.
  check('the sums are scoped to that customer rather than coming back empty', res.body.sums.totalMinor === 150000, res.body.sums);
  check('payments are counted', res.body.sums.paidMinor === 30000, res.body.sums);
  check('and so is anything credited', res.body.sums.creditedMinor === 20000, res.body.sums);
  check('so what is owed matches the statement', res.body.sums.totalMinor - res.body.sums.paidMinor - res.body.sums.creditedMinor === 100000, res.body.sums);
}

section('the dashboard');
{
  const res = await call(owner, `${W}/dashboard`);
  check('aging is offered as a widget', res.body.available.includes('receivables_aging'), res.body.available);
}

await finish();
