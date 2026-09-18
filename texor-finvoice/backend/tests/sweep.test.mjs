/**
 * The background sweep: payment reminders, quote-expiry and warranty-expiry
 * nudges, plus the lease that stops two instances doing the same work.
 *
 * Data is set up over the API like any other suite, but the sweep itself runs
 * in this process so the clock can be moved without waiting for one.
 */
process.env.DELIVERY_DRY_RUN = '1';

import mongoose from 'mongoose';
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();
const { claimLease, sweep } = await import('../src/services/sweep.service.js');

const owner = await seedUser(db, { texorId: 'tx-swp', email: 'swp@volt.test', displayName: 'Sweep Owner' });
const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Sweep Electronics', industry: 'electronics', gstin: '27AAPFU0939F1ZV', sample: true } });
const W = `/api/w/${created.body.workspace.slug}`;
const workspaceId = new mongoose.Types.ObjectId(created.body.workspace._id);

const { body: { items } } = await call(owner, `${W}/items?limit=50`);
const tv = items.find((i) => i.name.includes('LED TV'));
const amc = items.find((i) => i.kind === 'service' && !i.trackSerials);

const customer = await call(owner, `${W}/records/customers`, { method: 'POST', body: { name: 'Meera Rao', phone: '9820000004', email: 'meera@example.test', stateCode: '27' } });
const customerId = customer.body.record._id;

const days = (n) => new Date(Date.now() + n * 86400000);
const iso = (d) => d.toISOString().slice(0, 10);
const logs = (filter = {}) => db.collection('deliverylogs').find({ workspace: workspaceId, ...filter }).toArray();

/** SMTP is workspace-level, so it is the channel a sweep can actually use. */
const smtp = await call(owner, `${W}/integrations/smtp`, { method: 'PUT', body: { host: 'smtp.zoho.in', port: 465, secure: true, user: 'billing@volt.test', password: 's3cret-pass', fromEmail: 'billing@volt.test', fromName: 'Volt' } });
if (smtp.status !== 200) { console.log('  SMTP setup failed:', smtp.status, JSON.stringify(smtp.body).slice(0, 300)); process.exit(1); }

section('reminders stay off until asked for');
{
  const invoice = await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: customerId, date: iso(days(-40)), dueDate: iso(days(-30)), lines: [{ item: tv._id, description: 'LED TV', quantity: 1, priceMinor: 3299000, taxRate: 18, serials: ['SW-1'] }] } });
  await call(owner, `${W}/documents/invoices/${invoice.body.document._id}/issue`, { method: 'POST' });

  const quiet = await sweep({ lock: false });
  check('a workspace that has not opted in is skipped', quiet.workspaces === 0, quiet);
  check('and nothing was sent', (await logs()).length === 0);
}

await call(owner, `${W}/settings/preferences`, { method: 'PATCH', body: { reminders: { enabled: true, channel: 'smtp', invoiceDays: [-3, 3, 10, 30], quoteDays: 3, warrantyDays: 30 } } });

section('payment reminders');
{
  const first = await sweep({ lock: false });
  check('an overdue invoice is reminded once', first.reminders === 1, first);
  const sent = await logs({ kind: 'invoices' });
  check('the delivery is logged as sent', sent.length === 1 && sent[0].status === 'sent', sent[0]);
  check('and recorded as coming from Finvoice, not a person', sent[0].sentBy === null && sent[0].sentByName === 'Finvoice', sent[0]);
  check('the reminder wording is used, not the covering note', /gentle reminder/i.test(sent[0].subject) || /reminder/i.test(sent[0].subject), sent[0].subject);

  const second = await sweep({ lock: false });
  check('running again does not send it twice', second.reminders === 0, second);
  check('and no second log row appears', (await logs({ kind: 'invoices' })).length === 1);

  const invoice = await db.collection('invoices').findOne({ workspace: workspaceId });
  check('the offset it was sent at is remembered', invoice.remindedOffsets.includes(30), invoice.remindedOffsets);
  check('and the earlier ones are retired, so a late invoice is not told it is 3 days late',
    [-3, 3, 10].every((d) => invoice.remindedOffsets.includes(d)), invoice.remindedOffsets);
}

section('a paid invoice is left alone');
{
  const invoice = await db.collection('invoices').findOne({ workspace: workspaceId });
  await call(owner, `${W}/documents/invoices/${invoice._id}/payments`, { method: 'POST', body: { amountMinor: invoice.totals.totalMinor, mode: 'UPI' } });
  await db.collection('invoices').updateOne({ _id: invoice._id }, { $set: { remindedOffsets: [] } });
  const after = await sweep({ lock: false });
  check('nothing owed means nothing to chase', after.reminders === 0, after);
}

section('quote expiry');
{
  const quote = await call(owner, `${W}/documents/quotations`, { method: 'POST', body: { customer: customerId, date: iso(days(-5)), validUntil: iso(days(2)), lines: [{ item: tv._id, description: 'LED TV', quantity: 1, priceMinor: 3299000, taxRate: 18 }] } });
  check('a quotation expiring inside the window is drafted', quote.status === 201, quote.body);

  const run = await sweep({ lock: false });
  check('it is nudged once', run.quotes === 1, run);
  check('over the quotation channel', (await logs({ kind: 'quotations' })).length === 1);

  const again = await sweep({ lock: false });
  check('and not nudged a second time', again.quotes === 0, again);
}

section('warranty expiry');
{
  const warranty = await db.collection('warranties').findOne({ workspace: workspaceId });
  check('the issued invoice minted a warranty to work with', Boolean(warranty), warranty);
  await db.collection('warranties').updateOne({ _id: warranty._id }, { $set: { endDate: days(10), customer: customer.body.record._id ? warranty.customer : warranty.customer } });

  const run = await sweep({ lock: false });
  check('cover about to lapse is nudged', run.warranties === 1, run);
  const sent = await logs({ kind: 'warranties' });
  check('the nudge is logged against the warranty', sent.length === 1, sent);
  check('with no PDF attached, because a warranty card has none', sent[0].status === 'sent');

  const again = await sweep({ lock: false });
  check('and only once', again.warranties === 0, again);
}

section('recurring invoices');
{
  const { advance } = await import('../src/services/schedule.service.js');
  const jan31 = advance(new Date('2027-01-31T00:00:00Z'), 1, 'months');
  check('a monthly run on the 31st lands on the last day of a short month, not in March',
    jan31.getMonth() === 1 && jan31.getDate() === 28, jan31.toISOString());

  const serialised = await call(owner, `${W}/schedules`, { method: 'POST', body: {
    title: 'Nope', customer: customerId,
    lines: [{ item: tv._id, description: 'LED TV', quantity: 1, priceMinor: 3299000, taxRate: 18 }],
    every: { n: 1, unit: 'months' }, nextRunAt: days(1).toISOString(),
  } });
  check('a serial-tracked product cannot repeat, and says so at setup', serialised.status === 400 && /serial/i.test(JSON.stringify(serialised.body)), serialised.body);

  const made = await call(owner, `${W}/schedules`, { method: 'POST', body: {
    title: 'Monthly AMC', customer: customerId,
    lines: [{ item: amc._id, description: 'AMC — LED TV', quantity: 1, priceMinor: 150000, taxRate: 18 }],
    every: { n: 1, unit: 'months' }, nextRunAt: days(-1).toISOString(), dueDays: 7, autoSend: true, channel: 'smtp',
  } });
  check('a repeating invoice can be set up', made.status === 201, made.body);
  const scheduleId = made.body.schedule._id;

  const before = (await call(owner, `${W}/documents/invoices`)).body.total;
  const run = await sweep({ lock: false });
  check('a schedule that has come due raises one invoice', run.invoices === 1, run);
  const after = await call(owner, `${W}/documents/invoices`);
  check('and it is a real, issued invoice with a number', after.body.total === before + 1 && after.body.documents[0].number, after.body.documents[0]);
  check('sent automatically, because the schedule asked for it', (await logs({ kind: 'invoices', sentByName: 'Finvoice' })).length >= 2);

  const idle = await sweep({ lock: false });
  check('and it does not run again the same day', idle.invoices === 0, idle);

  const moved = (await call(owner, `${W}/schedules`)).body.schedules.find((x) => x._id === scheduleId);
  check('the next run is a month out', new Date(moved.nextRunAt) > new Date(), moved.nextRunAt);
  check('and the run is counted', moved.runCount === 1, moved);
}

section('a schedule that fell behind');
{
  const made = await call(owner, `${W}/schedules`, { method: 'POST', body: {
    title: 'Weekly cleaning', customer: customerId,
    lines: [{ description: 'Weekly cleaning', quantity: 1, priceMinor: 50000, taxRate: 18 }],
    every: { n: 7, unit: 'days' }, nextRunAt: days(-30).toISOString(),
  } });
  const id = made.body.schedule._id;
  const run = await sweep({ lock: false });
  check('raises one invoice, not the four it missed', run.invoices === 1, run);
  const moved = (await call(owner, `${W}/schedules`)).body.schedules.find((x) => x._id === id);
  check('and skips forward to a future date rather than replaying the backlog', new Date(moved.nextRunAt) > new Date(), moved.nextRunAt);
}

section('pausing');
{
  const list = (await call(owner, `${W}/schedules`)).body.schedules;
  const one = list.find((x) => x.status === 'active');
  await call(owner, `${W}/schedules/${one._id}`, { method: 'PATCH', body: { status: 'paused', nextRunAt: days(-1).toISOString() } });
  const run = await sweep({ lock: false });
  check('a paused schedule is skipped even when due', run.invoices === 0, run);
}

section('the lease');
{
  const key = `sweep:test:${Date.now()}`;
  const now = Date.now();
  check('the first instance claims it', (await claimLease(60000, now, key)) === true);
  check('a second instance is turned away', (await claimLease(60000, now, key)) === false);
  check('and can claim it once the lease has lapsed', (await claimLease(60000, now + 61000, key)) === true);
}

await finish();
