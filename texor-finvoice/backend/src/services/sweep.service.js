/**
 * The one background timer in Finvoice.
 *
 * Three features ride the same sweep because they are the same shape: find
 * records whose date has crossed a line, send one message, mark them so it
 * never goes twice.
 *
 *   · recurring invoices    — schedules that have come due
 *   · payment reminders     — invoices around their due date
 *   · quotation expiry      — quotes approaching `validUntil`
 *   · warranty expiry       — cover approaching `endDate`, which is a sales
 *                             opportunity as much as a courtesy
 *
 * Deliberately a `setInterval` in the API process claiming a lease, not a queue
 * library: a queue would mean Redis, and Finvoice does not depend on a service
 * it does not ship. The lease makes it safe to run more than one instance — one
 * wins the tick, the rest return immediately.
 */
import Counter from '../models/Counter.js';
import Customer from '../models/Customer.js';
import Invoice from '../models/Invoice.js';
import Quotation from '../models/Quotation.js';
import Warranty from '../models/Warranty.js';
import Workspace from '../models/Workspace.js';
import logger from '../utils/logger.js';
import { deliverDocument, normalisePhone } from './delivery.service.js';
import { runDueSchedules } from './schedule.service.js';

const DAY = 86400000;
const LOCK_KEY = 'sweep:lease';

/** Channels that can send with nobody watching. `whatsapp_link` needs a human to click it. */
const UNATTENDED = new Set(['smtp', 'whatsapp_cloud']);

export const DEFAULT_REMINDERS = {
  enabled: false,
  channel: 'smtp',
  // Negative is before the due date. One message per offset, ever.
  invoiceDays: [-3, 3, 10, 30],
  quoteDays: 3,
  warrantyDays: 30,
};

/**
 * Claims the sweep for `leaseMs`. The Counter collection already exists for
 * atomic numbering; here `value` holds the epoch at which the claim lapses, so
 * a crashed instance releases it by expiry rather than leaving a stuck flag.
 */
export async function claimLease(leaseMs, now = Date.now(), key = LOCK_KEY) {
  const taken = await Counter.findOneAndUpdate(
    { key, value: { $lt: now } },
    { $set: { value: now + leaseMs } },
    { returnDocument: 'after' },
  );
  if (taken) return true;
  try {
    await Counter.create({ key, value: now + leaseMs });
    return true;
  } catch {
    return false; // someone else created it first, so they hold the lease
  }
}

const settingsFor = (workspace) => ({ ...DEFAULT_REMINDERS, ...(workspace.preferences?.reminders ?? {}) });

/** Where a message for this customer should go, for the chosen channel. */
function addressFor(channel, customer, fallback = {}) {
  if (channel === 'whatsapp_cloud') return normalisePhone(customer?.phone || fallback.phone) ?? '';
  return (customer?.email || fallback.email || '').trim();
}

async function send({ workspace, kind, document, channel, to, variant }) {
  await deliverDocument({
    workspace,
    kind,
    document,
    variant,
    input: { channel, to, cc: [], attachPdf: kind !== 'warranties' },
    actor: null,
  });
}

/** Invoices that are owed money and have crossed one of the configured offsets. */
async function remindOverdue(workspace, settings, now) {
  const offsets = (settings.invoiceDays ?? []).filter((d) => Number.isFinite(d)).sort((a, b) => a - b);
  if (!offsets.length) return 0;

  const invoices = await Invoice.find({
    workspace: workspace._id,
    deletedAt: null,
    status: { $in: ['issued', 'partial'] },
    dueDate: { $ne: null, $lte: new Date(now.getTime() - Math.min(...offsets) * DAY) },
  }).limit(200).lean();

  let sent = 0;
  for (const invoice of invoices) {
    if (invoice.totals.totalMinor - invoice.amountPaidMinor <= 0) continue;
    const age = Math.floor((now - new Date(invoice.dueDate)) / DAY);
    const reached = offsets.filter((d) => age >= d);
    // Only the latest offset is worth sending: nobody who is 30 days late needs
    // to be told they are 3 days late. The earlier ones are retired with it, so
    // an invoice that arrives already overdue gets one message, not a backlog.
    const due = reached.filter((d) => !(invoice.remindedOffsets ?? []).includes(d)).pop();
    if (due === undefined) continue;

    const to = addressFor(settings.channel, null, invoice.billTo);
    if (!to) continue;
    try {
      await send({ workspace, kind: 'invoices', document: invoice, channel: settings.channel, to, variant: 'reminder' });
      sent += 1;
    } catch (error) {
      logger.warn('reminder failed', { invoice: invoice.number, message: error.message });
    }
    // Marked either way: a bounced address must not be retried every five minutes.
    await Invoice.updateOne({ _id: invoice._id }, { $addToSet: { remindedOffsets: { $each: reached } } });
  }
  return sent;
}

/** Quotes about to lapse — a nudge while the customer can still say yes. */
async function nudgeQuotes(workspace, settings, now) {
  const days = Number(settings.quoteDays);
  if (!Number.isFinite(days) || days <= 0) return 0;

  const quotations = await Quotation.find({
    workspace: workspace._id,
    deletedAt: null,
    status: { $in: ['draft', 'sent'] },
    expiryNudgedAt: null,
    validUntil: { $ne: null, $gte: now, $lte: new Date(now.getTime() + days * DAY) },
  }).limit(200).lean();

  let sent = 0;
  for (const quotation of quotations) {
    const to = addressFor(settings.channel, null, quotation.billTo);
    if (to) {
      try {
        await send({ workspace, kind: 'quotations', document: quotation, channel: settings.channel, to, variant: 'expiring' });
        sent += 1;
      } catch (error) {
        logger.warn('quote nudge failed', { quotation: quotation.number, message: error.message });
      }
    }
    await Quotation.updateOne({ _id: quotation._id }, { $set: { expiryNudgedAt: now } });
  }
  return sent;
}

/**
 * Warranties about to run out. This is the one nudge that makes money rather
 * than collecting it: you know what they bought, when its cover ends and how to
 * reach them.
 */
async function nudgeWarranties(workspace, settings, now) {
  const days = Number(settings.warrantyDays);
  if (!Number.isFinite(days) || days <= 0) return 0;

  const warranties = await Warranty.find({
    workspace: workspace._id,
    deletedAt: null,
    status: 'active',
    expiryNudgedAt: null,
    endDate: { $gte: now, $lte: new Date(now.getTime() + days * DAY) },
  }).populate({ path: 'customer', select: 'name email phone', model: Customer }).limit(200).lean();

  let sent = 0;
  for (const warranty of warranties) {
    const to = addressFor(settings.channel, warranty.customer);
    if (to) {
      try {
        await send({ workspace, kind: 'warranties', document: warranty, channel: settings.channel, to, variant: 'expiring' });
        sent += 1;
      } catch (error) {
        logger.warn('warranty nudge failed', { warranty: String(warranty._id), message: error.message });
      }
    }
    await Warranty.updateOne({ _id: warranty._id }, { $set: { expiryNudgedAt: now } });
  }
  return sent;
}

/**
 * One pass over every workspace that has asked for reminders. Never throws: a
 * single bad workspace must not stop the others, and a failed tick must not
 * take the API process with it.
 */
export async function sweep({ now = new Date(), leaseMs = 4 * 60000, lock = true } = {}) {
  if (lock && !(await claimLease(leaseMs, now.getTime()))) return { skipped: true };

  const totals = { workspaces: 0, invoices: 0, reminders: 0, quotes: 0, warranties: 0 };

  // Recurring invoices are not a reminder setting — they run wherever one is set up.
  try {
    totals.invoices = await runDueSchedules(now);
  } catch (error) {
    logger.error('repeating invoices failed', { message: error.message });
  }

  const workspaces = await Workspace.find({ 'preferences.reminders.enabled': true }).lean();
  totals.workspaces = workspaces.length;

  for (const workspace of workspaces) {
    const settings = settingsFor(workspace);
    if (!UNATTENDED.has(settings.channel)) continue;
    try {
      totals.reminders += await remindOverdue(workspace, settings, now);
      totals.quotes += await nudgeQuotes(workspace, settings, now);
      totals.warranties += await nudgeWarranties(workspace, settings, now);
    } catch (error) {
      logger.error('sweep failed for a workspace', { workspace: workspace.slug, message: error.message });
    }
  }

  if (totals.invoices || totals.reminders || totals.quotes || totals.warranties) logger.info('sweep did work', totals);
  return totals;
}

/** Starts the timer. Returns a stop function for shutdown. */
export function startSweep(intervalMs) {
  if (!intervalMs) return () => {};
  const timer = setInterval(() => {
    sweep({ leaseMs: Math.max(intervalMs - 1000, 30000) }).catch((error) => logger.error('sweep threw', { message: error.message }));
  }, intervalMs);
  logger.info('sweep scheduled', { everyMinutes: Math.round(intervalMs / 60000) });
  return () => clearInterval(timer);
}
