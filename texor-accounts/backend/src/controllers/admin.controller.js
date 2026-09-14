/**
 * Platform administration.
 *
 * Two things live here that a self-service developer must never reach:
 *
 *   publishing     an app in `testing` works only for accounts its owner
 *                  listed. Moving it to `published` opens it to everyone, so
 *                  that decision belongs to a human at Texor.
 *   first-party    skips the consent screen outright. An app that could set
 *                  this on itself could collect tokens without ever asking.
 */
import { z } from 'zod';
import Client from '../models/Client.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { describeScopes } from '../config/scopes.js';
import { toConsoleApp } from '../services/app.service.js';

export const reviewDecisionSchema = z.object({
  notes: z.string().max(2000).optional().default(''),
});

export const adminPatchSchema = z.object({
  isFirstParty: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  resourceIndicator: z.url().nullable().optional(),
  allowedScopes: z.array(z.string()).optional(),
});

export const listQuerySchema = z.object({
  status: z.enum(['testing', 'in_review', 'published']).optional(),
  q: z.string().max(120).optional(),
});

/** Adds the owner's email, which is the first thing a reviewer wants. */
async function withOwners(clients) {
  const ownerIds = clients.map((client) => client.owner).filter(Boolean);
  const owners = ownerIds.length
    ? await User.find({ _id: { $in: ownerIds } }).select('email').lean()
    : [];
  const byId = new Map(owners.map((owner) => [owner._id.toString(), owner.email]));

  return clients.map((client) => ({
    ...toConsoleApp(client),
    owner: client.owner ? byId.get(client.owner.toString()) ?? null : null,
    scopeDetails: describeScopes(client.allowedScopes),
  }));
}

export async function getApps(req, res) {
  const filter = {};

  if (req.query.status) filter.publishingStatus = req.query.status;
  if (req.query.q) {
    const safe = req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { clientName: { $regex: safe, $options: 'i' } },
      { clientId: { $regex: safe, $options: 'i' } },
    ];
  }

  const clients = await Client.find(filter).sort({ submittedForReviewAt: -1, createdAt: -1 }).exec();

  res.json({ apps: await withOwners(clients) });
}

export async function getOneApp(req, res) {
  const client = await Client.findOne({ clientId: req.params.clientId }).exec();
  if (!client) throw ApiError.notFound('App not found.');

  const [app] = await withOwners([client]);
  res.json({ app });
}

export async function patchApp(req, res) {
  const client = await Client.findOne({ clientId: req.params.clientId }).exec();
  if (!client) throw ApiError.notFound('App not found.');

  const { isFirstParty, status, resourceIndicator, allowedScopes } = req.body;

  if (isFirstParty !== undefined) {
    client.isFirstParty = isFirstParty;
    logger.warn('first-party flag changed', {
      clientId: client.clientId,
      isFirstParty,
      by: req.user._id.toString(),
    });
  }

  if (status !== undefined) client.status = status;
  if (resourceIndicator !== undefined) client.resourceIndicator = resourceIndicator;
  if (allowedScopes !== undefined) client.allowedScopes = allowedScopes;

  await client.save();

  const [app] = await withOwners([client]);
  res.json({ app });
}

export async function publishApp(req, res) {
  const client = await Client.findOne({ clientId: req.params.clientId }).exec();
  if (!client) throw ApiError.notFound('App not found.');

  client.publishingStatus = 'published';
  client.publishedAt = new Date();
  client.reviewNotes = req.body.notes ?? '';
  await client.save();

  logger.info('app published', { clientId: client.clientId, by: req.user._id.toString() });

  const [app] = await withOwners([client]);
  res.json({ app });
}

/**
 * Sends an app back to its developer.
 *
 * It returns to `testing` rather than being blocked outright, so the developer
 * keeps working with their test accounts while they address the notes.
 */
export async function rejectApp(req, res) {
  const client = await Client.findOne({ clientId: req.params.clientId }).exec();
  if (!client) throw ApiError.notFound('App not found.');

  if (client.effectivePublishingStatus() !== 'in_review') {
    throw ApiError.conflict('This app is not awaiting review.');
  }

  client.publishingStatus = 'testing';
  client.submittedForReviewAt = null;
  client.reviewNotes = req.body.notes ?? '';
  await client.save();

  logger.info('app review rejected', { clientId: client.clientId, by: req.user._id.toString() });

  const [app] = await withOwners([client]);
  res.json({ app });
}
