/**
 * Online payments: the business's own Razorpay keys, a payment link on an
 * invoice, and the webhook that records the money when it lands.
 *
 * Nothing here talks to Razorpay — DELIVERY_DRY_RUN stands in for the API, so
 * what is under test is the signature check, the idempotency and the bookkeeping.
 */
import crypto from 'node:crypto';
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();
const owner = await seedUser(db, { texorId: 'tx-rzp', email: 'rzp@volt.test', displayName: 'Pay Owner' });
const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Pay Electronics', industry: 'electronics', gstin: '27AAPFU0939F1ZV', sample: true } });
const slug = created.body.workspace.slug;
const W = `/api/w/${slug}`;

const product = await call(owner, `${W}/records/products`, { method: 'POST', body: { name: 'Air purifier', priceMinor: 1000000, taxRate: 18, trackStock: false, trackSerials: false, priceIncludesTax: false } });
const customer = await call(owner, `${W}/records/customers`, { method: 'POST', body: { name: 'Nisha Rao', phone: '9820000031', email: 'nisha@example.test', stateCode: '27' } });

const newInvoice = async () => {
  const draft = await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: customer.body.record._id, date: new Date().toISOString().slice(0, 10), lines: [{ item: product.body.record._id, description: 'Air purifier', quantity: 1, priceMinor: 1000000, taxRate: 18 }] } });
  const issued = await call(owner, `${W}/documents/invoices/${draft.body.document._id}/issue`, { method: 'POST' });
  return issued.body.document;
};

const WEBHOOK_SECRET = 'whsec-test-1234';
const post = (body, signature) => fetch(`${process.env.TEST_API ?? 'http://localhost:4101'}/api/webhooks/razorpay/${slug}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(signature ? { 'x-razorpay-signature': signature } : {}) },
  body,
});
const sign = (body, secret = WEBHOOK_SECRET) => crypto.createHmac('sha256', secret).update(body).digest('hex');
const paidEvent = (invoice, paymentId, amountMinor) => JSON.stringify({
  event: 'payment_link.paid',
  payload: { payment: { entity: { id: paymentId, amount: amountMinor, method: 'upi', notes: { invoice: String(invoice._id) } } } },
});

section('connecting');
{
  const before = await call(owner, `${W}/documents/invoices/000000000000000000000000/payment-link`, { method: 'POST' });
  check('asking for a link before connecting is refused', before.status === 404 || before.status === 400, before.status);

  const bad = await call(owner, `${W}/integrations/razorpay`, { method: 'PUT', body: { keyId: 'not-a-key', keySecret: 'x' } });
  check('a key id that is not one is refused', bad.status === 400, bad.body);

  const noSecret = await call(owner, `${W}/integrations/razorpay`, { method: 'PUT', body: { keyId: 'rzp_test_ABC123' } });
  check('the key secret is required the first time', noSecret.status === 400, noSecret.body);

  const ok = await call(owner, `${W}/integrations/razorpay`, { method: 'PUT', body: { keyId: 'rzp_test_ABC123', keySecret: 'shhh', webhookSecret: WEBHOOK_SECRET } });
  check('Razorpay connects with the business’s own keys', ok.status === 200, ok.body);

  const list = await call(owner, `${W}/integrations`);
  check('and shows as connected', list.body.razorpay?.connected === true, list.body.razorpay);
  check('with the webhook address to paste into Razorpay', /\/api\/webhooks\/razorpay\//.test(list.body.razorpay.webhookUrl), list.body.razorpay);
  check('the key secret never comes back out', !JSON.stringify(list.body).includes('shhh'));

  const prefs = await call(owner, `${W}/`);
  check('an Online payment mode is added, so a webhook has somewhere to book to', prefs.body.workspace.preferences.paymentModes.includes('Online'), prefs.body.workspace.preferences.paymentModes);
}

section('the payment link');
{
  const invoice = await newInvoice();
  const link = await call(owner, `${W}/documents/invoices/${invoice._id}/payment-link`, { method: 'POST' });
  check('a link is raised for what is owed', link.status === 200 && link.body.url, link.body);

  const again = await call(owner, `${W}/documents/invoices/${invoice._id}/payment-link`, { method: 'POST' });
  check('asking twice reuses it rather than raising another', again.body.reused === true, again.body);

  const pub = await call(null, `/api/public/documents/${(await call(owner, `${W}/documents/invoices/${invoice._id}`)).body.document.publicToken}`);
  check('the customer’s copy carries a pay button', Boolean(pub.body.document.payUrl), pub.body.document.payUrl);
}

section('the webhook');
{
  const invoice = await newInvoice();
  const body = paidEvent(invoice, 'pay_TEST0001', invoice.totals.totalMinor);

  const unsigned = await post(body, null);
  check('an unsigned call is rejected', unsigned.status === 401, unsigned.status);
  const wrong = await post(body, sign(body, 'not-the-secret'));
  check('a wrongly signed call is rejected', wrong.status === 401, wrong.status);
  const tampered = await post(paidEvent(invoice, 'pay_TEST0001', 1), sign(body));
  check('a body that does not match its signature is rejected', tampered.status === 401, tampered.status);

  const good = await post(body, sign(body));
  check('a properly signed payment is accepted', good.status === 200, good.status);

  const after = await call(owner, `${W}/documents/invoices/${invoice._id}`);
  check('the invoice is marked paid', after.body.document.status === 'paid', after.body.document.status);
  check('with nothing owing', after.body.document.amountDueMinor === 0, after.body.document.amountDueMinor);

  const payments = await call(owner, `${W}/payments`);
  const recorded = payments.body.payments.find((p) => p.reference === 'pay_TEST0001');
  check('a payment is recorded against it', Boolean(recorded), payments.body.payments);
  check('under the Online mode', recorded?.mode === 'Online', recorded?.mode);

  const replay = await post(body, sign(body));
  check('Razorpay replaying the same payment is a no-op', (await replay.json()).duplicate === true);
  const stillOne = await call(owner, `${W}/payments`);
  check('so the money is not counted twice', stillOne.body.payments.filter((p) => p.reference === 'pay_TEST0001').length === 1);
}

section('events we do not act on');
{
  const invoice = await newInvoice();
  const body = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_FAIL', amount: 100, notes: { invoice: String(invoice._id) } } } } });
  const res = await post(body, sign(body));
  check('a failed payment is acknowledged but not booked', res.status === 200 && (await res.json()).ignored === true);
  const after = await call(owner, `${W}/documents/invoices/${invoice._id}`);
  check('and the invoice is untouched', after.body.document.status === 'issued', after.body.document.status);
}

section('an unknown workspace');
{
  const body = JSON.stringify({ event: 'payment_link.paid', payload: {} });
  const res = await fetch(`${process.env.TEST_API ?? 'http://localhost:4101'}/api/webhooks/razorpay/nope-not-real`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(body) }, body });
  check('is a 404, not a crash', res.status === 404, res.status);
}

await finish();
