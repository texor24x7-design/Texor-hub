/**
 * Resolves `/api/w/:workspace/...` to a workspace the signed-in user belongs to.
 *
 * A workspace the user is not an active member of answers 404, not 403: whether
 * a business uses Finvoice under a given slug is not something to confirm to a
 * stranger.
 */
import mongoose from 'mongoose';
import Member from '../models/Member.js';
import Workspace from '../models/Workspace.js';
import ApiError from '../utils/ApiError.js';
import { assertCan, scopeOf } from '../services/rbac.service.js';
import { requireUsableModule } from '../services/metadata.service.js';

export async function loadWorkspace(req, _res, next) {
  if (!req.user) return next(ApiError.unauthorized('Sign in with Texor to continue.'));

  const ref = req.params.workspace;
  const filter = mongoose.isValidObjectId(ref) ? { _id: ref } : { slug: ref };
  const workspace = await Workspace.findOne(filter).lean();
  if (!workspace) return next(ApiError.notFound('Workspace not found.'));

  const member = await Member.findOne({ workspace: workspace._id, user: req.user._id, status: 'active' }).lean();
  if (!member) return next(ApiError.notFound('Workspace not found.'));

  req.workspace = workspace;
  req.member = member;
  return next();
}

/**
 * `authorize('invoices', 'create')`, or `authorize(req => req.params.module, 'view')`
 * for routes shared by many modules. Also sets `req.scope` ('all' | 'own').
 */
export const authorize = (moduleKey, action) => (req, _res, next) => {
  const key = typeof moduleKey === 'function' ? moduleKey(req) : moduleKey;
  requireUsableModule(req.workspace, key);
  assertCan(req.workspace, req.member, key, action);
  req.moduleKey = key;
  req.scope = scopeOf(req.workspace, req.member, key, action);
  next();
};

/** The filter every workspace query starts from. */
export function scoped(req, extra = {}) {
  const filter = { workspace: req.workspace._id, deletedAt: null, ...extra };
  if (req.scope === 'own') filter.createdBy = req.user._id;
  return filter;
}
