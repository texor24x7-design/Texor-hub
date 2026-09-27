import { z } from 'zod';
import * as purchases from '../services/purchase.service.js';

const lineSchema = z.object({
  item: z.string().nullish(),
  description: z.string().trim().min(1, 'Describe what was bought.'),
  hsn: z.string().default(''),
  quantity: z.coerce.number().min(0),
  unit: z.string().default(''),
  priceMinor: z.coerce.number().int().min(0),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
  cessRate: z.coerce.number().min(0).max(100).default(0),
  priceIncludesTax: z.boolean().default(false),
});

export const billSchema = z.object({
  vendor: z.string().min(1),
  number: z.string().trim().min(1, "Enter the supplier's bill number.").max(40),
  date: z.coerce.date(),
  dueDate: z.coerce.date().nullish(),
  lines: z.array(lineSchema).min(1, 'Add at least one line.').max(200),
  discount: z.object({ type: z.enum(['percent', 'amount']), value: z.coerce.number().min(0) }).nullish(),
  roundOff: z.boolean().default(false),
  reference: z.string().trim().max(120).default(''),
  notes: z.string().trim().max(2000).default(''),
  attachment: z.string().nullish(),
});

export const payBillSchema = z.object({
  payments: z.array(z.object({
    amountMinor: z.coerce.number().int().min(1),
    mode: z.string().trim().min(1),
    date: z.coerce.date().optional(),
    reference: z.string().trim().max(120).default(''),
    note: z.string().trim().max(2000).default(''),
  })).min(1).max(8),
});

export const record = async (req, res) => res.status(201).json({ bill: await purchases.recordBill(req, req.body) });
export const list = async (req, res) => res.json(await purchases.listBills(req, req.query));
export const get = async (req, res) => res.json(await purchases.getBill(req, req.params.id));
export const voidBill = async (req, res) => res.json({ bill: await purchases.voidBill(req, req.params.id) });
export const pay = async (req, res) => res.status(201).json(await purchases.payBill(req, req.params.id, req.body));
