/**
 * GSTR-1 — does each sale land in the section the law puts it in?
 *
 * That is the whole job. The tax itself was worked out and frozen when the
 * invoice was issued, and is checked in `tax`; what this suite checks is the
 * sorting: a GSTIN makes a sale B2B however small it is, a big inter-state sale
 * to a consumer is listed on its own, everything else is summarised, and a
 * draft — which was never issued — appears nowhere at all.
 */
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();
const owner = await seedUser(db, { texorId: 'tx-gst', email: 'gst@file.test', displayName: 'Filing Owner' });
// Maharashtra (27), so Karnataka (29) is another state.
const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Filing Traders', industry: 'general', gstin: '27AAPFU0939F1ZV' } });
const W = `/api/w/${created.body.workspace.slug}`;
await call(owner, `${W}/settings/edition`, { method: 'PUT', body: { edition: 'pro' } });

const MONTH = '2026-02';
const DAY = `${MONTH}-10`;

const customer = async (body) => (await call(owner, `${W}/records/customers`, { method: 'POST', body })).body.record;
const registered = await customer({ name: 'Bengaluru Hotels Pvt Ltd', gstin: '29AAGCB7383J1Z4' });
const localWalkIn = await customer({ name: 'Priya Nair', phone: '9820000123', stateCode: '27' });
const farWalkIn = await customer({ name: 'Ravi Kumar', phone: '9820000124', stateCode: '29' });

async function invoice(who, lines, { issue = true, date = DAY, placeOfSupply } = {}) {
  const draft = await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: who._id, date, lines, ...(placeOfSupply ? { placeOfSupply } : {}) } });
  if (!issue) return draft.body.document;
  const issued = await call(owner, `${W}/documents/invoices/${draft.body.document._id}/issue`, { method: 'POST', body: {} });
  return issued.body.document;
}

const line = (priceMinor, taxRate = 18, hsn = '8528', quantity = 1) => ({ description: 'Television', hsn, quantity, priceMinor, taxRate, priceIncludesTax: false, unit: 'PCS' });

const b2bInvoice = await invoice(registered, [line(100000)]);
const bigFar = await invoice(farWalkIn, [line(300000_00)]);
const smallFar = await invoice(farWalkIn, [line(50000)]);
const localOne = await invoice(localWalkIn, [line(20000)]);
const localTwo = await invoice(localWalkIn, [line(30000, 18, '8528', 2)]);
const neverIssued = await invoice(localWalkIn, [line(999999)], { issue: false });
const lastMonth = await invoice(localWalkIn, [line(77700)], { date: '2026-01-15' });

const gstr1 = async (month = MONTH) => (await call(owner, `${W}/gst/gstr1?month=${month}`)).body;

section('a return is only of what was issued, in the month asked for');
{
  const data = await gstr1();
  check('the period is named', data.month === MONTH, data.month);
  check('a draft is in no section at all', JSON.stringify(data).includes(neverIssued.number ?? 'no-number') === false, neverIssued.number);
  check('and last month stays in last month', !JSON.stringify(data).includes(lastMonth.number), lastMonth.number);
  check('January can still be asked for on its own', (await gstr1('2026-01')).totals.invoices === 1, (await gstr1('2026-01')).totals.invoices);
}

section('a GSTIN makes it B2B, however small');
{
  const data = await gstr1();
  check('the registered sale is listed invoice by invoice', data.b2b.length === 1 && data.b2b[0].number === b2bInvoice.number, data.b2b);
  check('under the customer’s GSTIN', data.b2b[0].gstin === '29AAGCB7383J1Z4', data.b2b[0]?.gstin);
  check('as an inter-state supply, so IGST', data.b2b[0].rates[0].igstMinor > 0 && data.b2b[0].rates[0].cgstMinor === 0, data.b2b[0]?.rates);
  check('and it is not repeated in the consumer sections', !data.b2cl.some((r) => r.number === b2bInvoice.number), data.b2cl);
}

section('a large inter-state consumer sale is listed on its own');
{
  const data = await gstr1();
  check('it is in B2CL', data.b2cl.length === 1 && data.b2cl[0].number === bigFar.number, data.b2cl);
  check('because it is over ₹2.5 lakh', bigFar.totals.totalMinor > 250000_00, bigFar.totals.totalMinor);
  check('the smaller one from the same state is not', !data.b2cl.some((r) => r.number === smallFar.number), data.b2cl);
}

section('everything else is summarised, not listed');
{
  const data = await gstr1();
  const intra = data.b2cs.find((r) => !r.interState);
  const inter = data.b2cs.find((r) => r.interState);

  check('the two local sales become one row', Boolean(intra), data.b2cs);
  check('adding up to what they were worth', intra.taxableMinor === 20000 + 60000, intra?.taxableMinor);
  check('taxed as CGST and SGST', intra.cgstMinor > 0 && intra.sgstMinor === intra.cgstMinor && intra.igstMinor === 0, intra);
  check('the small far sale is a row of its own, as inter-state', Boolean(inter) && inter.igstMinor > 0, inter);
  check('no invoice number appears in B2CS at all', !JSON.stringify(data.b2cs).includes('INV'), data.b2cs);
}

section('HSN covers everything supplied');
{
  const data = await gstr1();
  const row = data.hsn.find((r) => r.hsn === '8528');
  check('one row per code and rate', data.hsn.length === 1 && row.rate === 18, data.hsn);
  check('quantities add up across every sale', row.quantity === 1 + 1 + 1 + 1 + 2, row?.quantity);
  check('and the unit is carried as its UQC', row.uqc === 'PCS', row?.uqc);
}

section('a credit note lands in CDNR and comes off HSN');
{
  const raised = await call(owner, `${W}/documents/invoices/${b2bInvoice._id}/note/credit_notes`, { method: 'POST' });
  const note = raised.body.document;
  await call(owner, `${W}/documents/credit_notes/${note._id}`, { method: 'PATCH', body: { date: DAY } });
  const issued = await call(owner, `${W}/documents/credit_notes/${note._id}/issue-note`, { method: 'POST' });
  check('the note issues', issued.body.document?.status === 'issued', issued.body);

  const data = await gstr1();
  check('it is reported against the registered customer', data.cdnr.length === 1 && data.cdnr[0].gstin === '29AAGCB7383J1Z4', data.cdnr);
  check('naming the invoice it answers', data.cdnr[0].against === b2bInvoice.number, data.cdnr[0]?.against);
  check('and it is counted as credited, not as a sale', data.totals.creditedMinor > 0 && data.totals.notes === 1, data.totals);

  const row = data.hsn.find((r) => r.hsn === '8528');
  check('the returned unit comes back out of the HSN quantity', row.quantity === 6 - 1, row?.quantity);
  check('and its tax comes off the HSN total too', row.taxableMinor < data.totals.taxableMinor, { hsn: row?.taxableMinor, sales: data.totals.taxableMinor });
}

section('the workbook');
{
  const res = await call(owner, `${W}/gst/gstr1/export?month=${MONTH}`, { raw: true });
  const buffer = Buffer.from(await res.arrayBuffer());
  check('downloads as a spreadsheet named for the return', res.headers.get('content-disposition').includes(`gstr1-27AAPFU0939F1ZV-${MONTH}.xlsx`), res.headers.get('content-disposition'));
  check('and is a real workbook', buffer[0] === 0x50 && buffer.length > 2000, buffer.length);
}

section('who may see it');
{
  const noGstin = await seedUser(db, { texorId: 'tx-nogst', email: 'nogst@file.test', displayName: 'Unregistered' });
  const plain = await call(noGstin, '/api/workspaces', { method: 'POST', body: { name: 'No GSTIN Co', industry: 'general' } });
  const P = `/api/w/${plain.body.workspace.slug}`;
  await call(noGstin, `${P}/settings/edition`, { method: 'PUT', body: { edition: 'pro' } });
  const refused = await call(noGstin, `${P}/gst/gstr1?month=${MONTH}`);
  check('a business with no GSTIN is told it files nothing', refused.status === 400 && /GSTIN/.test(refused.body.error.message), refused.body);

  const lite = await seedUser(db, { texorId: 'tx-lite', email: 'lite@file.test', displayName: 'Lite Owner' });
  const liteWs = await call(lite, '/api/workspaces', { method: 'POST', body: { name: 'Lite Traders', industry: 'general', gstin: '27AAPFU0939F1ZV' } });
  const locked = await call(lite, `/api/w/${liteWs.body.workspace.slug}/gst/gstr1?month=${MONTH}`);
  check('and Lite is offered the upgrade rather than the return', locked.status === 402, locked.body);
}

section('a bad month');
{
  const nonsense = await call(owner, `${W}/gst/gstr1?month=February`);
  check('is refused rather than guessed at', nonsense.status === 400, nonsense.body);
}

await finish();
