import * as schedules from '../services/schedule.service.js';

export const { scheduleSchema, updateSchema } = schedules;

export const list = async (req, res) => res.json(await schedules.list(req));
export const create = async (req, res) => res.status(201).json(await schedules.create(req, req.body));
export const update = async (req, res) => res.json(await schedules.update(req, req.params.id, req.body));

export async function remove(req, res) {
  await schedules.remove(req, req.params.id);
  res.json({ ok: true });
}
