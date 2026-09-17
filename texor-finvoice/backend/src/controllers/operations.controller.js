import * as attendance from '../services/attendance.service.js';
import * as warranties from '../services/warranty.service.js';
import { dashboard as buildDashboard, search as runSearch } from '../services/dashboard.service.js';

export const day = async (req, res) => res.json(await attendance.day(req, req.query.date));
export const register = async (req, res) => res.json(await attendance.register(req, req.query.month));
export const mark = async (req, res) => res.json({ entry: await attendance.mark(req, req.params.staff, req.params.date, req.body) });
export const me = async (req, res) => res.json(await attendance.me(req));
export const checkIn = async (req, res) => res.json({ entry: await attendance.check(req, 'in', req.body) });
export const checkOut = async (req, res) => res.json({ entry: await attendance.check(req, 'out', req.body) });

export async function registerCsv(req, res) {
  const csv = await attendance.registerCsv(req, req.query.month);
  res.set('content-type', 'text/csv; charset=utf-8');
  res.set('content-disposition', `attachment; filename="attendance-${String(req.query.month ?? 'month').replace(/[^\d-]/g, '')}.csv"`);
  res.send(csv);
}

export const addClaim = async (req, res) => res.status(201).json(await warranties.addClaim(req, req.params.id, req.body));
export const updateClaim = async (req, res) => res.json({ warranty: await warranties.updateClaim(req, req.params.id, req.params.claim, req.body) });
export const voidWarranty = async (req, res) => res.json({ warranty: await warranties.voidWarranty(req, req.params.id) });
export const shareWarranty = async (req, res) => res.json(await warranties.share(req, req.params.id));
export const publicWarranty = async (req, res) => {
  res.set('cache-control', 'private, no-store');
  res.json(await warranties.publicCard(req.params.token));
};

export const dashboard = async (req, res) => res.json(await buildDashboard(req));
export const search = async (req, res) => res.json(await runSearch(req, req.query.q));
