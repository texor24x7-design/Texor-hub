/**
 * The dashboard: the widgets a workspace chose (seeded by its industry pack),
 * each computed only if the member may see what it summarises.
 */
import Attendance from '../models/Attendance.js';
import Customer from '../models/Customer.js';
import Invoice from '../models/Invoice.js';
import Item from '../models/Item.js';
import Payment from '../models/Payment.js';
import Quotation from '../models/Quotation.js';
import Record from '../models/Record.js';
import Staff from '../models/Staff.js';
import Warranty from '../models/Warranty.js';
import { dayIn } from './attendance.service.js';
import { effectiveModules } from './metadata.service.js';
import { can, scopeOf } from './rbac.service.js';
import { bucketsFor } from './ledger.service.js';
import { escapeRegex } from './record.service.js';

const DAY = 864e5;
const LIVE = ['issued', 'partial', 'paid'];

/** Midnight in the workspace's zone, as an instant. IST has no DST, so the offset trick is exact there. */
function startOfDay(timezone, instant = new Date()) {
  const ymd = dayIn(timezone, instant);
  const offsetMinutes = (() => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(instant).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const m = parts.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  })();
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - offsetMinutes * 60000);
}

const own = (req, module) => (scopeOf(req.workspace, req.member, module, 'view') === 'own' ? { createdBy: req.user._id } : {});

const WIDGETS = {
  /** How old the money owed is — the view that decides who gets chased first. */
  async receivables_aging(req) {
    if (!can(req.workspace, req.member, 'invoices', 'view')) return null;
    const filter = { workspace: req.workspace._id, deletedAt: null, status: { $in: ['issued', 'partial'] }, ...own(req, 'invoices') };
    const invoices = await Invoice.find(filter).select('dueDate totals.totalMinor amountPaidMinor creditedMinor').lean();
    return bucketsFor(invoices);
  },

  async sales_today(req, t) {
    if (!can(req.workspace, req.member, 'invoices', 'view')) return null;
    const [row] = await Invoice.aggregate([
      { $match: { workspace: req.workspace._id, deletedAt: null, status: { $in: LIVE }, date: { $gte: t.today }, ...own(req, 'invoices') } },
      { $group: { _id: null, totalMinor: { $sum: '$totals.totalMinor' }, count: { $sum: 1 } } },
    ]);
    const [yesterday] = await Invoice.aggregate([
      { $match: { workspace: req.workspace._id, deletedAt: null, status: { $in: LIVE }, date: { $gte: new Date(t.today - DAY), $lt: t.today }, ...own(req, 'invoices') } },
      { $group: { _id: null, totalMinor: { $sum: '$totals.totalMinor' } } },
    ]);
    return { totalMinor: row?.totalMinor ?? 0, count: row?.count ?? 0, previousMinor: yesterday?.totalMinor ?? 0 };
  },

  async sales_month(req, t) {
    if (!can(req.workspace, req.member, 'invoices', 'view')) return null;
    const since = new Date(t.today - 29 * DAY);
    const series = await Invoice.aggregate([
      { $match: { workspace: req.workspace._id, deletedAt: null, status: { $in: LIVE }, date: { $gte: since }, ...own(req, 'invoices') } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: req.workspace.timezone } }, totalMinor: { $sum: '$totals.totalMinor' } } },
      { $sort: { _id: 1 } },
    ]);
    const map = new Map(series.map((s) => [s._id, s.totalMinor]));
    const days = Array.from({ length: 30 }, (_, i) => {
      const key = dayIn(req.workspace.timezone, new Date(since.getTime() + i * DAY + DAY / 2));
      return { date: key, totalMinor: map.get(key) ?? 0 };
    });
    const [previous] = await Invoice.aggregate([
      { $match: { workspace: req.workspace._id, deletedAt: null, status: { $in: LIVE }, date: { $gte: new Date(since - 30 * DAY), $lt: since }, ...own(req, 'invoices') } },
      { $group: { _id: null, totalMinor: { $sum: '$totals.totalMinor' } } },
    ]);
    return { totalMinor: days.reduce((a, d) => a + d.totalMinor, 0), previousMinor: previous?.totalMinor ?? 0, days };
  },

  async receivables(req, t) {
    if (!can(req.workspace, req.member, 'invoices', 'view')) return null;
    const [row] = await Invoice.aggregate([
      { $match: { workspace: req.workspace._id, deletedAt: null, status: { $in: ['issued', 'partial'] }, ...own(req, 'invoices') } },
      { $project: { due: { $subtract: ['$totals.totalMinor', '$amountPaidMinor'] }, overdue: { $and: [{ $ne: ['$dueDate', null] }, { $lt: ['$dueDate', t.today] }] } } },
      { $group: { _id: null, dueMinor: { $sum: '$due' }, count: { $sum: 1 }, overdueMinor: { $sum: { $cond: ['$overdue', '$due', 0] } }, overdueCount: { $sum: { $cond: ['$overdue', 1, 0] } } } },
    ]);
    return { dueMinor: row?.dueMinor ?? 0, count: row?.count ?? 0, overdueMinor: row?.overdueMinor ?? 0, overdueCount: row?.overdueCount ?? 0 };
  },

  async overdue(req, t) {
    if (!can(req.workspace, req.member, 'invoices', 'view')) return null;
    const rows = await Invoice.find({ workspace: req.workspace._id, deletedAt: null, status: { $in: ['issued', 'partial'] }, dueDate: { $lt: t.today }, ...own(req, 'invoices') })
      .select('number billTo.name dueDate totals.totalMinor amountPaidMinor').sort({ dueDate: 1 }).limit(6).lean();
    return rows.map((r) => ({ _id: r._id, number: r.number, customer: r.billTo?.name, dueDate: r.dueDate, dueMinor: r.totals.totalMinor - r.amountPaidMinor, days: Math.floor((t.today - r.dueDate) / DAY) }));
  },

  async quotes_open(req, t) {
    if (!can(req.workspace, req.member, 'quotations', 'view')) return null;
    const base = { workspace: req.workspace._id, deletedAt: null, status: 'sent', ...own(req, 'quotations') };
    const [row] = await Quotation.aggregate([
      { $match: { ...base, $or: [{ validUntil: null }, { validUntil: { $gte: t.today } }] } },
      { $group: { _id: null, totalMinor: { $sum: '$totals.totalMinor' }, count: { $sum: 1 } } },
    ]);
    const expiring = await Quotation.countDocuments({ ...base, validUntil: { $gte: t.today, $lte: new Date(t.today.getTime() + 7 * DAY) } });
    return { totalMinor: row?.totalMinor ?? 0, count: row?.count ?? 0, expiringThisWeek: expiring };
  },

  async low_stock(req) {
    if (!can(req.workspace, req.member, 'products', 'view')) return null;
    return Item.find({ workspace: req.workspace._id, deletedAt: null, kind: 'product', trackStock: true, lowStock: { $ne: null }, $expr: { $lte: ['$stock', '$lowStock'] } })
      .select('name stock lowStock unit').sort({ stock: 1 }).limit(8).lean();
  },

  async warranties_expiring(req, t) {
    if (!can(req.workspace, req.member, 'warranties', 'view')) return null;
    return Warranty.find({ workspace: req.workspace._id, deletedAt: null, status: 'active', endDate: { $gte: t.today, $lte: new Date(t.today.getTime() + 30 * DAY) } })
      .select('itemName serial endDate customer').populate('customer', 'name phone').sort({ endDate: 1 }).limit(8).lean();
  },

  async attendance_today(req) {
    if (!can(req.workspace, req.member, 'staff', 'view')) return null;
    const date = dayIn(req.workspace.timezone);
    const [total, entries] = await Promise.all([
      Staff.countDocuments({ workspace: req.workspace._id, deletedAt: null, active: true }),
      Attendance.aggregate([{ $match: { workspace: req.workspace._id, date } }, { $group: { _id: '$status', count: { $sum: 1 }, late: { $sum: { $cond: ['$late', 1, 0] } } } }]),
    ]);
    const counts = Object.fromEntries(entries.map((e) => [e._id, e.count]));
    const marked = entries.reduce((a, e) => a + e.count, 0);
    return { total, present: (counts.present ?? 0) + (counts.half_day ?? 0), absent: counts.absent ?? 0, leave: counts.leave ?? 0, unmarked: Math.max(total - marked, 0), late: entries.reduce((a, e) => a + e.late, 0) };
  },

  async top_items(req, t) {
    if (!can(req.workspace, req.member, 'invoices', 'view')) return null;
    return Invoice.aggregate([
      { $match: { workspace: req.workspace._id, deletedAt: null, status: { $in: LIVE }, date: { $gte: new Date(t.today - 29 * DAY) }, ...own(req, 'invoices') } },
      { $unwind: '$lines' },
      { $group: { _id: { $ifNull: ['$lines.item', '$lines.description'] }, name: { $first: '$lines.description' }, quantity: { $sum: '$lines.quantity' }, totalMinor: { $sum: '$lines.totalMinor' } } },
      { $sort: { totalMinor: -1 } },
      { $limit: 6 },
    ]);
  },

  async payment_modes_today(req, t) {
    if (!can(req.workspace, req.member, 'payments', 'view')) return null;
    return Payment.aggregate([
      { $match: { workspace: req.workspace._id, deletedAt: null, date: { $gte: t.today } } },
      { $group: { _id: '$mode', amountMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
      { $sort: { amountMinor: -1 } },
    ]);
  },

  async recent_invoices(req) {
    if (!can(req.workspace, req.member, 'invoices', 'view')) return null;
    return Invoice.find({ workspace: req.workspace._id, deletedAt: null, ...own(req, 'invoices') })
      .select('number status billTo.name date totals.totalMinor amountPaidMinor').sort({ createdAt: -1 }).limit(6).lean();
  },
};

async function board(req, moduleKey) {
  const module = effectiveModules(req.workspace).find((m) => m.key === moduleKey);
  if (!module?.enabled || !module.boardField || !can(req.workspace, req.member, moduleKey, 'view')) return null;
  const field = module.fields.find((f) => f.key === module.boardField);
  const counts = await Record.aggregate([
    { $match: { workspace: req.workspace._id, module: moduleKey, deletedAt: null, ...own(req, moduleKey) } },
    { $group: { _id: `$custom.${field.key}`, count: { $sum: 1 } } },
  ]);
  const byValue = new Map(counts.map((c) => [c._id, c.count]));
  return { module: moduleKey, label: module.label, columns: (field.options ?? []).map((o) => ({ value: o.value, label: o.label, count: byValue.get(o.value) ?? 0 })) };
}

export async function dashboard(req) {
  const today = startOfDay(req.workspace.timezone);
  const chosen = req.workspace.preferences?.dashboard ?? ['sales_month', 'receivables', 'overdue', 'quotes_open', 'low_stock', 'warranties_expiring'];
  const t = { today };
  const widgets = await Promise.all(chosen.map(async (key) => {
    const data = key.startsWith('board:') ? await board(req, key.slice(6)) : await WIDGETS[key]?.(req, t);
    return data == null ? null : { key, data };
  }));
  return { widgets: widgets.filter(Boolean), available: [...Object.keys(WIDGETS), ...effectiveModules(req.workspace).filter((m) => m.boardField).map((m) => `board:${m.key}`)] };
}

// ── search ────────────────────────────────────────────────────────────────────

export async function search(req, raw) {
  const q = String(raw ?? '').trim().toLowerCase().slice(0, 80);
  if (q.length < 2) return { results: [] };
  const rx = { $regex: escapeRegex(q) };
  const ws = req.workspace._id;
  const modules = effectiveModules(req.workspace).filter((m) => m.enabled && !m.locked);
  const allowed = (key) => modules.some((m) => m.key === key) && can(req.workspace, req.member, key, 'view');
  const base = { workspace: ws, deletedAt: null };
  const jobs = [];

  if (allowed('customers')) jobs.push(Customer.find({ ...base, searchText: rx }).select('name phone').limit(5).lean().then((r) => r.map((d) => ({ module: 'customers', id: d._id, title: d.name, subtitle: d.phone }))));
  for (const kind of ['invoices', 'quotations']) {
    if (!allowed(kind)) continue;
    const Model = kind === 'invoices' ? Invoice : Quotation;
    jobs.push(Model.find({ ...base, ...own(req, kind), searchText: rx }).select('number billTo.name status totals.totalMinor').sort({ date: -1 }).limit(5).lean()
      .then((r) => r.map((d) => ({ module: kind, id: d._id, title: d.number ?? 'Draft', subtitle: d.billTo?.name, status: d.status, amountMinor: d.totals?.totalMinor }))));
  }
  for (const kind of ['products', 'services']) {
    if (!allowed(kind)) continue;
    jobs.push(Item.find({ ...base, kind: kind.slice(0, -1), $or: [{ searchText: rx }, { barcode: q }] }).select('name sku priceMinor').limit(5).lean().then((r) => r.map((d) => ({ module: kind, id: d._id, title: d.name, subtitle: d.sku, amountMinor: d.priceMinor }))));
  }
  if (allowed('warranties')) jobs.push(Warranty.find({ ...base, searchText: rx }).select('itemName serial endDate').limit(5).lean().then((r) => r.map((d) => ({ module: 'warranties', id: d._id, title: d.itemName, subtitle: d.serial }))));
  if (allowed('staff')) jobs.push(Staff.find({ ...base, searchText: rx }).select('name designation').limit(5).lean().then((r) => r.map((d) => ({ module: 'staff', id: d._id, title: d.name, subtitle: d.designation }))));
  const custom = modules.filter((m) => m.custom && can(req.workspace, req.member, m.key, 'view')).map((m) => m.key);
  if (custom.length) jobs.push(Record.find({ ...base, module: { $in: custom }, searchText: rx }).select('module title').limit(8).lean().then((r) => r.map((d) => ({ module: d.module, id: d._id, title: d.title }))));

  const results = (await Promise.all(jobs)).flat();
  return { results };
}


