/**
 * Recurring invoices.
 *
 * A run does not have its own way of making an invoice: it builds a system
 * context and calls the same `create` and `issueInvoice` a person's request
 * would. Numbering, stock, warranties and the receivable all behave identically,
 * and there is only one transactional issue path to keep correct.
 */
import mongoose from 'mongoose';
import { z } from 'zod';
import Customer from '../models/Customer.js';
import Item from '../models/Item.js';
import Schedule from '../models/Schedule.js';
import Workspace from '../models/Workspace.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import * as documents from './document.service.js';
import { deliverDocument } from './delivery.service.js';
import { record as audit } from './audit.service.js';

const UNATTENDED = new Set(['smtp', 'whatsapp_cloud']);

/**
 * Stands in for a request when the sweep is the caller. `member.role` is
 * `owner` so nothing is hidden from the invoice it builds, and the user is
 * whoever set the schedule up, so stock movements and the audit trail name a
 * real person rather than nobody.
 */
const systemContext = (workspace, userId) => ({
  workspace,
  user: { _id: userId, displayName: 'Finvoice' },
  member: { role: 'owner', name: 'Finvoice', status: 'active' },
  ip: '',
});

/** Calendar-correct advance. The 31st of a short month lands on its last day, not in the next one. */
export function advance(date, n, unit) {
  const d = new Date(date);
  if (unit === 'days') d.setDate(d.getDate() + n);
  if (unit === 'weeks') d.setDate(d.getDate() + n * 7);
  if (unit === 'years') d.setFullYear(d.getFullYear() + n);
  if (unit === 'months') {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  }
  return d;
}

const lineSchema = z.object({
  item: z.string().nullish(),
  description: z.string().trim().max(500).default(''),
  variant: z.string().max(120).optional(),
  hsn: z.string().max(20).optional(),
  quantity: z.number().min(0),
  unit: z.string().max(30).optional(),
  priceMinor: z.number().int(),
  discountPct: z.number().min(0).max(100).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  cessRate: z.number().min(0).max(100).optional(),
  priceIncludesTax: z.boolean().optional(),
  custom: z.record(z.string(), z.any()).optional(),
}).passthrough();

export const scheduleSchema = z.object({
  title: z.string().trim().max(120).default(''),
  customer: z.string().min(1, 'Choose a customer.'),
  lines: z.array(lineSchema).min(1, 'Add at least one line.').max(100),
  notes: z.string().max(4000).default(''),
  terms: z.string().max(4000).default(''),
  custom: z.record(z.string(), z.any()).default({}),
  discount: z.any().nullish(),
  every: z.object({ n: z.number().int().min(1).max(365), unit: z.enum(['days', 'weeks', 'months', 'years']) }),
  nextRunAt: z.coerce.date(),
  endsOn: z.coerce.date().nullish(),
  dueDays: z.number().int().min(0).max(365).nullish(),
  autoSend: z.boolean().default(false),
  channel: z.enum(['smtp', 'whatsapp_cloud']).default('smtp'),
});

export const updateSchema = scheduleSchema.partial().extend({ status: z.enum(['active', 'paused']).optional() });

const templateOf = (input) => ({
  customer: input.customer, lines: input.lines, notes: input.notes, terms: input.terms,
  custom: input.custom, ...(input.discount ? { discount: input.discount } : {}),
});

export async function list(req) {
  const schedules = await Schedule.find({ workspace: req.workspace._id, deletedAt: null })
    .sort({ status: 1, nextRunAt: 1 }).limit(200).lean();
  return { schedules };
}

/**
 * A serial-tracked product cannot repeat: every unit needs its own serial, and
 * a schedule set up today cannot know next month's. Refusing at setup beats
 * failing silently on the first run and every one after it.
 */
async function assertRepeatable(workspaceId, lines) {
  const ids = lines.map((l) => l.item).filter(Boolean);
  if (!ids.length) return;
  const tracked = await Item.find({ _id: { $in: ids }, workspace: workspaceId, trackSerials: true }).select('name').lean();
  if (tracked.length) {
    throw ApiError.badRequest('Some fields need attention.', [{
      field: 'lines',
      message: `${tracked.map((i) => i.name).join(', ')} needs a serial number on every sale, so it cannot be part of a repeating invoice.`,
    }]);
  }
}

export async function create(req, body) {
  const customer = await Customer.findOne({ _id: body.customer, workspace: req.workspace._id, deletedAt: null }).lean();
  if (!customer) throw ApiError.badRequest('That customer no longer exists.');
  await assertRepeatable(req.workspace._id, body.lines);

  const schedule = await Schedule.create({
    workspace: req.workspace._id,
    title: body.title || `Every ${body.every.n} ${body.every.unit} — ${customer.name}`,
    customer: customer._id,
    customerName: customer.name,
    template: templateOf(body),
    every: body.every,
    nextRunAt: body.nextRunAt,
    endsOn: body.endsOn ?? null,
    dueDays: body.dueDays ?? null,
    autoSend: body.autoSend,
    channel: body.channel,
    searchText: `${body.title ?? ''} ${customer.name}`.toLowerCase().trim(),
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  await audit(req, { action: 'schedules.created', module: 'schedules', recordId: schedule._id, summary: `Set up a repeating invoice for ${customer.name}` });
  return { schedule: schedule.toObject() };
}

export async function update(req, id, body) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Schedule not found.');
  const schedule = await Schedule.findOne({ _id: id, workspace: req.workspace._id, deletedAt: null });
  if (!schedule) throw ApiError.notFound('Schedule not found.');

  for (const key of ['title', 'every', 'nextRunAt', 'endsOn', 'dueDays', 'autoSend', 'channel', 'status']) {
    if (body[key] !== undefined) schedule[key] = body[key];
  }
  if (body.lines) {
    await assertRepeatable(req.workspace._id, body.lines);
    schedule.template = { ...schedule.template, lines: body.lines };
    schedule.markModified('template');
  }
  schedule.updatedBy = req.user._id;
  await schedule.save();
  await audit(req, { action: 'schedules.updated', module: 'schedules', recordId: schedule._id, summary: `Updated the repeating invoice for ${schedule.customerName}` });
  return { schedule: schedule.toObject() };
}

export async function remove(req, id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Schedule not found.');
  const schedule = await Schedule.findOneAndUpdate(
    { _id: id, workspace: req.workspace._id, deletedAt: null },
    { $set: { deletedAt: new Date(), status: 'ended' } },
  );
  if (!schedule) throw ApiError.notFound('Schedule not found.');
  await audit(req, { action: 'schedules.deleted', module: 'schedules', recordId: schedule._id, summary: `Stopped the repeating invoice for ${schedule.customerName}` });
}

/** Raises and issues one invoice for a schedule, and moves it on. */
export async function runOnce(schedule, workspace, { now = new Date() } = {}) {
  const ctx = systemContext(workspace, schedule.createdBy);
  const body = { ...schedule.template, date: now.toISOString() };
  if (Number.isFinite(schedule.dueDays)) body.dueDate = new Date(now.getTime() + schedule.dueDays * 86400000).toISOString();

  const draft = await documents.create(ctx, 'invoices', body);
  let issued;
  try {
    issued = await documents.issueInvoice(ctx, draft._id);
  } catch (error) {
    // Otherwise a schedule that cannot issue quietly piles up a draft a month.
    await documents.remove(ctx, 'invoices', draft._id).catch(() => {});
    throw error;
  }

  if (schedule.autoSend && UNATTENDED.has(schedule.channel)) {
    const to = schedule.channel === 'whatsapp_cloud' ? (issued.billTo?.phone ?? '') : (issued.billTo?.email ?? '');
    if (to) {
      await deliverDocument({
        workspace,
        kind: 'invoices',
        document: issued,
        input: { channel: schedule.channel, to, cc: [], attachPdf: true },
        actor: null,
      });
    }
  }
  return issued;
}

/**
 * Every schedule that has come due, across all workspaces.
 *
 * A schedule that fell behind — the server was off for a week — raises **one**
 * invoice and then skips forward to the next future date. Catching up properly
 * would bill a customer five times in a minute, which is worse than a gap.
 */
export async function runDueSchedules(now = new Date()) {
  const due = await Schedule.find({ status: 'active', nextRunAt: { $lte: now }, deletedAt: null }).limit(200);
  if (!due.length) return 0;

  const workspaces = new Map();
  let raised = 0;

  for (const schedule of due) {
    try {
      const key = String(schedule.workspace);
      if (!workspaces.has(key)) workspaces.set(key, await Workspace.findById(schedule.workspace).lean());
      const workspace = workspaces.get(key);
      if (!workspace) continue;

      const issued = await runOnce(schedule, workspace, { now });
      schedule.lastInvoice = issued._id;
      schedule.runCount += 1;
      schedule.lastError = '';
      raised += 1;
    } catch (error) {
      schedule.lastError = String(error.message ?? error).slice(0, 300);
      logger.warn('a repeating invoice failed', { schedule: String(schedule._id), message: schedule.lastError });
    }

    let next = advance(schedule.nextRunAt, schedule.every.n, schedule.every.unit);
    while (next <= now) next = advance(next, schedule.every.n, schedule.every.unit);
    schedule.nextRunAt = next;
    schedule.lastRunAt = now;
    if (schedule.endsOn && next > schedule.endsOn) schedule.status = 'ended';
    await schedule.save();
  }
  return raised;
}
