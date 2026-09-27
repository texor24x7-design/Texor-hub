/**
 * The buying side: vendors, their bills, and what is owed to them.
 *
 * A bill runs the same tax engine as an invoice with the parties swapped, and
 * that swap is the thing most likely to be quietly wrong: on a sale the
 * customer's state decides the split, on a purchase the *vendor's* does. A
 * local purchase that claims IGST it was never charged is a wrong return, not a
 * wrong screen, so both directions are checked here.
 */
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();
const owner = await seedUser(db, { texorId: 'tx-buy', email: 'buy@shop.test', displayName: 'Buying Owner' });
// The business is in Maharashtra (27).
const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Buying Traders', industry: 'general', gstin: '27AAPFU0939F1ZV' } });
const W = `/api/w/${created.body.workspace.slug}`;
await call(owner, `${W}/settings/edition`, { method: 'PUT', body: { edition: 'pro' } });

const vendor = async (body) => (await call(owner, `${W}/records/vendors`, { method: 'POST', body })).body.record;
// Real GSTINs: the checksum is enforced, so a state code cannot just be swapped.
const local = await vendor({ name: 'Mumbai Wholesale', gstin: '27AAPFU0939F1ZV' });
const faraway = await vendor({ name: 'Bengaluru Supply', gstin: '29AAGCB7383J1Z4' });
const unregistered = await vendor({ name: 'Corner Hardware', phone: '9820000999', stateCode: '27' });

const product = (await call(owner, `${W}/records/products`, {
  method: 'POST', body: { name: 'Ceiling fan', priceMinor: 250000, taxRate: 18, trackStock: true, trackSerials: false, priceIncludesTax: false, openingStock: 10 },
})).body.record;

const stockNow = async () => (await call(owner, `${W}/records/products/${product._id}`)).body.record.stock;
const owed = async (id) => (await call(owner, `${W}/records/vendors/${id}`)).body.record.payableMinor;

const bill = (body) => call(owner, `${W}/bills`, { method: 'POST', body });
const line = (quantity, priceMinor = 200000, taxRate = 18) => ({ item: product._id, description: product.name, hsn: '8414', quantity, unit: 'PCS', priceMinor, taxRate, priceIncludesTax: false });

section('a vendor is a record like any other');
{
  check('the GSTIN sets their state, the way a customer’s does', local.stateCode === '27' && faraway.stateCode === '29', { local: local.stateCode, far: faraway.stateCode });
  check('and they start owing nothing', local.payableMinor === 0, local.payableMinor);
}

section('recording a bill');
{
  const before = await stockNow();
  const res = await bill({ vendor: local._id, number: 'MW/2026/118', date: '2026-02-04', lines: [line(5)] });
  check('the bill is recorded', res.status === 201, res.body);
  check('under the supplier’s own number, not one of ours', res.body.bill.number === 'MW/2026/118', res.body.bill?.number);
  check('five fans land on the shelf', (await stockNow()) === before + 5, { before, now: await stockNow() });
  check('and the vendor is owed the bill total', (await owed(local._id)) === res.body.bill.totals.totalMinor, await owed(local._id));
  check('nothing is still due on it until it is paid', res.body.bill.amountDueMinor === res.body.bill.totals.totalMinor, res.body.bill.amountDueMinor);
}

section('the tax is the mirror of a sale');
{
  const localBill = await bill({ vendor: local._id, number: 'MW/2026/119', date: '2026-02-05', lines: [line(1)] });
  const t = localBill.body.bill.totals;
  check('a supplier in the same state charged CGST and SGST', t.cgstMinor > 0 && t.cgstMinor === t.sgstMinor && t.igstMinor === 0, t);

  const farBill = await bill({ vendor: faraway._id, number: 'BS/88', date: '2026-02-05', lines: [line(1)] });
  const f = farBill.body.bill.totals;
  check('a supplier in another state charged IGST', f.igstMinor > 0 && f.cgstMinor === 0, f);
  check('and the bill knows it was inter-state', farBill.body.bill.interState === true, farBill.body.bill.interState);
  check('both come to the same money, split differently', t.totalMinor === f.totalMinor, { local: t.totalMinor, far: f.totalMinor });

  const cash = await bill({ vendor: unregistered._id, number: 'CH-9', date: '2026-02-05', lines: [line(1)] });
  check('a supplier with no GSTIN charged no tax, so there is nothing to claim', cash.body.bill.totals.taxMinor === 0, cash.body.bill.totals);
}

section('the same bill twice');
{
  const again = await bill({ vendor: local._id, number: 'MW/2026/118', date: '2026-02-04', lines: [line(5)] });
  check('is refused', again.status === 409 && /already recorded/i.test(again.body.error.message), again.body);

  const elsewhere = await bill({ vendor: faraway._id, number: 'MW/2026/118', date: '2026-02-04', lines: [line(1)] });
  check('but the same number from a different supplier is fine', elsewhere.status === 201, elsewhere.body);
}

section('what a bill needs');
{
  const noNumber = await bill({ vendor: local._id, number: '  ', date: '2026-02-06', lines: [line(1)] });
  check('a bill without the supplier’s number is refused', noNumber.status === 400, noNumber.body);

  const noLines = await bill({ vendor: local._id, number: 'MW/2026/200', date: '2026-02-06', lines: [] });
  check('and one with nothing on it', noLines.status === 400, noLines.body);

  const ghost = await bill({ vendor: '000000000000000000000000', number: 'X/1', date: '2026-02-06', lines: [line(1)] });
  check('a vendor that does not exist is refused', ghost.status === 400, ghost.body);
}

section('paying a vendor');
{
  const raised = await bill({ vendor: local._id, number: 'MW/2026/300', date: '2026-02-07', lines: [line(2)] });
  const b = raised.body.bill;
  const owedBefore = await owed(local._id);

  const over = await call(owner, `${W}/bills/${b._id}/payments`, { method: 'POST', body: { payments: [{ amountMinor: b.totals.totalMinor + 100, mode: 'Cash' }] } });
  check('paying more than the bill is refused', over.status === 400, over.body);

  const part = await call(owner, `${W}/bills/${b._id}/payments`, { method: 'POST', body: { payments: [{ amountMinor: 50000, mode: 'Cash' }] } });
  check('a part payment leaves it partly paid', part.body.bill?.status === 'partial', part.body.bill?.status);
  check('and lowers what the vendor is owed', (await owed(local._id)) === owedBefore - 50000, await owed(local._id));

  const rest = await call(owner, `${W}/bills/${b._id}/payments`, { method: 'POST', body: { payments: [{ amountMinor: b.totals.totalMinor - 50000, mode: 'Bank transfer' }] } });
  check('paying the rest settles it', rest.body.bill?.status === 'paid' && rest.body.bill.amountDueMinor === 0, rest.body.bill);

  const detail = await call(owner, `${W}/bills/${b._id}`);
  check('both payments are on the bill', detail.body.payments.length === 2, detail.body.payments?.length);

  const after = await call(owner, `${W}/bills/${b._id}/payments`, { method: 'POST', body: { payments: [{ amountMinor: 100, mode: 'Cash' }] } });
  check('a settled bill takes no more', after.status === 409, after.body);
}

section('voiding a bill');
{
  const raised = await bill({ vendor: local._id, number: 'MW/2026/400', date: '2026-02-08', lines: [line(3)] });
  const b = raised.body.bill;
  const stockBefore = await stockNow();
  const owedBefore = await owed(local._id);

  await call(owner, `${W}/bills/${b._id}/payments`, { method: 'POST', body: { payments: [{ amountMinor: 1000, mode: 'Cash' }] } });
  const paid = await call(owner, `${W}/bills/${b._id}/void`, { method: 'POST' });
  check('a bill with money against it cannot be voided', paid.status === 409, paid.body);

  const clean = await bill({ vendor: local._id, number: 'MW/2026/401', date: '2026-02-08', lines: [line(3)] });
  const withGoods = await stockNow();
  check('recording it put three more on the shelf', withGoods === stockBefore + 3, { before: stockBefore, now: withGoods });

  const voided = await call(owner, `${W}/bills/${clean.body.bill._id}/void`, { method: 'POST' });
  check('an unpaid one voids', voided.body.bill?.status === 'void', voided.body);
  check('and its goods come straight back off the shelf', (await stockNow()) === withGoods - 3, { expected: withGoods - 3, now: await stockNow() });
  check('and the payable is undone', (await owed(local._id)) === owedBefore - 1000, { expected: owedBefore - 1000, now: await owed(local._id) });
}

section('the list a payables screen reads');
{
  const all = await call(owner, `${W}/bills`);
  check('bills come back with their vendor names', Object.keys(all.body.vendors).length > 0, all.body.vendors);
  check('with input tax totalled for the period', all.body.sums.inputTaxMinor > 0, all.body.sums);

  const unpaid = await call(owner, `${W}/bills?state=unpaid`);
  check('and can be narrowed to what is still owed', unpaid.body.bills.every((x) => x.status !== 'paid' && x.status !== 'void'), unpaid.body.bills.map((x) => x.status));
}

section('purchases are Pro');
{
  const lite = await seedUser(db, { texorId: 'tx-buylite', email: 'buylite@shop.test', displayName: 'Lite Buyer' });
  const ws = await call(lite, '/api/workspaces', { method: 'POST', body: { name: 'Lite Buyer Co', industry: 'general' } });
  const L = `/api/w/${ws.body.workspace.slug}`;
  const locked = await call(lite, `${L}/bills`);
  check('Lite is offered the upgrade instead', locked.status === 402, locked.body);
  const lockedVendors = await call(lite, `${L}/records/vendors`);
  check('and vendors are behind the same door', lockedVendors.status === 402, lockedVendors.body);
}

await finish();
