import mongoose from 'mongoose';
import env from '../config/env.js';
import Member from '../models/Member.js';
import Workspace from '../models/Workspace.js';
import ApiError from '../utils/ApiError.js';
import { randomToken } from '../utils/ids.js';
import logger from '../utils/logger.js';
import * as delivery from '../services/delivery.service.js';
import * as documents from '../services/document.service.js';

const STATE_COOKIE = 'finvoice_gmail_state';

export const list = async (req, res) => res.json(await delivery.listIntegrations(req));
export const saveSmtp = async (req, res) => res.json({ integration: await delivery.saveSmtp(req, req.body) });
export const saveWhatsapp = async (req, res) => res.json({ integration: await delivery.saveWhatsapp(req, req.body) });

export async function remove(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Integration not found.');
  await delivery.removeIntegration(req, req.params.id);
  res.json({ ok: true });
}

/** A full-page redirect to Google; the state ties the callback to this user and workspace. */
export function connectGmail(req, res) {
  const nonce = randomToken(18);
  const state = `${req.workspace._id}.${nonce}`;
  res.cookie(STATE_COOKIE, JSON.stringify({ state, user: String(req.user._id), slug: req.workspace.slug }), {
    httpOnly: true, sameSite: 'lax', secure: env.isProduction, signed: true, maxAge: 10 * 60 * 1000, path: '/api/integrations/gmail',
  });
  res.redirect(delivery.gmailAuthUrl(state));
}

export async function gmailCallback(req, res) {
  const saved = (() => { try { return JSON.parse(req.signedCookies?.[STATE_COOKIE] ?? ''); } catch { return null; } })();
  res.clearCookie(STATE_COOKIE, { path: '/api/integrations/gmail' });

  const back = (slug, params) => res.redirect(`${env.appOrigin}/w/${slug}/settings/integrations?${new URLSearchParams(params)}`);
  if (!saved || !req.user || saved.state !== req.query.state || saved.user !== String(req.user._id)) {
    return res.redirect(`${env.appOrigin}/?error=${encodeURIComponent('The Gmail connection could not be verified. Please try again.')}`);
  }
  if (req.query.error) return back(saved.slug, { error: req.query.error === 'access_denied' ? 'Gmail access was not granted.' : String(req.query.error) });

  const workspaceId = saved.state.split('.')[0];
  const member = await Member.findOne({ workspace: workspaceId, user: req.user._id, status: 'active' }).lean();
  if (!member || !(await Workspace.exists({ _id: workspaceId }))) return back(saved.slug, { error: 'You are no longer a member of this workspace.' });

  try {
    await delivery.completeGmail({ code: String(req.query.code ?? ''), workspaceId, userId: req.user._id });
    return back(saved.slug, { connected: 'gmail' });
  } catch (error) {
    logger.warn('gmail connection failed', { message: error.message });
    return back(saved.slug, { error: error.message });
  }
}

export const send = async (req, res) => res.json(await delivery.sendDocument(req, req.params.kind, req.params.id, req.body));
export const deliveries = async (req, res) => res.json({ deliveries: await delivery.deliveriesFor(req, req.params.id) });

export async function compose(req, res) {
  const { document } = await documents.get(req, req.params.kind, req.params.id);
  res.json({ ...delivery.messagesFor(req, req.params.kind, document), email: document.billTo?.email ?? '', phone: document.billTo?.phone ?? '' });
}
