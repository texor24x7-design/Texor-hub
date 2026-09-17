/** Warranty claims, voiding, and the shareable warranty card. */
import mongoose from 'mongoose';
import { z } from 'zod';
import Warranty from '../models/Warranty.js';
import Workspace from '../models/Workspace.js';
import ApiError from '../utils/ApiError.js';
import { randomToken } from '../utils/ids.js';
import { record as audit } from './audit.service.js';
import { moduleOf } from './metadata.service.js';

async function load(req, id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Warranty not found.');
  const filter = { _id: id, workspace: req.workspace._id, deletedAt: null };
  if (req.scope === 'own') filter.createdBy = req.user._id;
  const warranty = await Warranty.findOne(filter);
  if (!warranty) throw ApiError.notFound('Warranty not found.');
  return warranty;
}

export const claimSchema = z.object({
  issue: z.string().trim().min(3, 'Describe the problem.').max(2000),
  photos: z.array(z.string().regex(/^[A-Za-z0-9_-]{16,64}$/)).max(10).default([]),
});

export async function addClaim(req, id, input) {
  const warranty = await load(req, id);
  if (warranty.status === 'void') throw ApiError.conflict('This warranty was voided and cannot take claims.');
  warranty.claims.push({ ...input, createdBy: req.user._id });
  await warranty.save();
  const expired = warranty.endDate < new Date();
  await audit(req, { action: 'warranties.claim', module: 'warranties', recordId: warranty._id, summary: `Claim raised on ${warranty.itemName}${expired ? ' (after expiry)' : ''}` });
  return { warranty: warranty.toObject(), outOfWarranty: expired };
}

export const claimUpdateSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'rejected']),
  resolution: z.string().trim().max(2000).default(''),
});

export async function updateClaim(req, id, claimId, input) {
  const warranty = await load(req, id);
  const claim = warranty.claims.id(claimId);
  if (!claim) throw ApiError.notFound('Claim not found.');
  claim.status = input.status;
  claim.resolution = input.resolution;
  claim.resolvedAt = ['resolved', 'rejected'].includes(input.status) ? new Date() : null;
  await warranty.save();
  await audit(req, { action: 'warranties.claim_updated', module: 'warranties', recordId: warranty._id, summary: `Claim on ${warranty.itemName} marked ${input.status.replace('_', ' ')}` });
  return warranty.toObject();
}

export async function voidWarranty(req, id) {
  const warranty = await load(req, id);
  warranty.status = 'void';
  await warranty.save();
  await audit(req, { action: 'warranties.voided', module: 'warranties', recordId: warranty._id, summary: `Voided warranty on ${warranty.itemName}` });
  return warranty.toObject();
}

export async function share(req, id) {
  const warranty = await load(req, id);
  warranty.shareToken ??= randomToken(24);
  await warranty.save();
  return { token: warranty.shareToken };
}

export async function publicCard(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{24,64}$/.test(token)) throw ApiError.notFound('This link is no longer available.');
  const warranty = await Warranty.findOne({ shareToken: token, deletedAt: null }).populate('customer', 'name').lean();
  if (!warranty) throw ApiError.notFound('This link is no longer available.');
  const workspace = await Workspace.findById(warranty.workspace).lean();
  const now = Date.now();
  const state = warranty.status === 'void' ? 'void' : warranty.endDate < now ? 'expired' : 'active';
  return {
    warranty: {
      itemName: warranty.itemName, serial: warranty.serial, startDate: warranty.startDate, endDate: warranty.endDate, coverage: warranty.coverage,
      invoiceNumber: warranty.invoiceNumber, customer: warranty.customer?.name ?? '', state,
      claims: warranty.claims.map(({ reportedAt, status }) => ({ reportedAt, status })),
    },
    business: { name: workspace.name, phone: workspace.phone, email: workspace.email, logo: workspace.branding?.logo, accent: workspace.branding?.accent, label: moduleOf(workspace, 'warranties').labelSingular },
  };
}
