/**
 * Sending quotations and invoices to customers.
 *
 * Four channels, all optional:
 *
 *   gmail           from the member's own Gmail, via the Gmail API (gmail.send)
 *   smtp            from the workspace's mail server
 *   whatsapp_link   a wa.me link the member opens — nothing to configure
 *   whatsapp_cloud  from the workspace's WhatsApp Business number, PDF attached
 *
 * Plain `fetch` against Google's and Meta's HTTP APIs rather than their SDKs:
 * three endpoints each do not justify two large dependencies.
 */
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import env from '../config/env.js';
import DeliveryLog from '../models/DeliveryLog.js';
import Integration from '../models/Integration.js';
import Invoice from '../models/Invoice.js';
import Quotation from '../models/Quotation.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { formatMoney } from '../../../frontend/src/lib/shared/money.mjs';
import { moduleOf } from './metadata.service.js';
import { can } from './rbac.service.js';
import { record as audit } from './audit.service.js';
import * as documents from './document.service.js';
import { pdfFilename, renderInput, toPdf } from './design.service.js';

const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const graph = (path) => `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${path}`;

// ── messages ──────────────────────────────────────────────────────────────────

export const DEFAULT_MESSAGES = {
  'email.subject': '{{document.label}} {{document.number}} from {{business.name}}',
  'email.body': 'Hi {{customer.name}},\n\nPlease find {{document.label}} {{document.number}} for {{document.total}} attached.\n\nYou can also view it online: {{document.link}}\n\nThank you,\n{{business.name}}',
  whatsapp: 'Hi {{customer.name}}, here is your {{document.label}} {{document.number}} from {{business.name}} for {{document.total}}.\n\nView or download: {{document.link}}',
};

function messageContext(workspace, kind, doc) {
  const label = moduleOf(workspace, kind).labelSingular;
  const due = kind === 'invoices' ? Math.max(doc.totals.totalMinor - doc.amountPaidMinor, 0) : doc.totals.totalMinor;
  return {
    'business.name': workspace.name,
    'business.phone': workspace.phone,
    'customer.name': doc.billTo?.name ?? '',
    'document.label': label.toLowerCase(),
    'document.Label': label,
    'document.number': doc.number ?? '',
    'document.total': formatMoney(doc.totals.totalMinor, doc.currency),
    'document.amountDue': formatMoney(due, doc.currency),
    'document.dueDate': doc.dueDate ? new Date(doc.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
    'document.link': doc.publicToken ? `${env.publicOrigin}/d/${doc.publicToken}` : '',
  };
}

/** Plain-text interpolation; unknown tags become nothing. */
export const fill = (template, ctx) => String(template ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => ctx[key] ?? '');

export function composeFor(workspace, kind, doc) {
  const saved = workspace.preferences?.messages ?? {};
  const pick = (key) => saved[`${key}.${kind}`] ?? saved[key] ?? DEFAULT_MESSAGES[key];
  const ctx = messageContext(workspace, kind, doc);
  const subject = fill(pick('email.subject'), ctx);
  return {
    subject: subject.charAt(0).toUpperCase() + subject.slice(1),
    body: fill(pick('email.body'), ctx),
    whatsapp: fill(pick('whatsapp'), ctx),
  };
}

/** Indian numbers without a country code get +91; everything else must carry one. */
export function normalisePhone(value) {
  const digits = String(value ?? '').replace(/[^\d+]/g, '');
  if (/^\+\d{8,15}$/.test(digits)) return digits.slice(1);
  const bare = digits.replace(/^\+/, '').replace(/^0+/, '');
  if (/^[6-9]\d{9}$/.test(bare)) return `91${bare}`;
  if (/^\d{11,15}$/.test(bare)) return bare;
  return null;
}

// ── integrations ──────────────────────────────────────────────────────────────

const publicIntegration = ({ _id, type, user, account, config, status, lastError, updatedAt }) => {
  const { password, ...safe } = config ?? {};
  return { _id, type, user, account, config: safe, status, lastError, updatedAt };
};

export async function listIntegrations(req) {
  const rows = await Integration.find({ workspace: req.workspace._id }).lean();
  return {
    gmailAvailable: env.gmailEnabled,
    integrations: rows.map(publicIntegration),
    mine: rows.filter((r) => r.type === 'gmail' && String(r.user) === String(req.user._id)).map(publicIntegration)[0] ?? null,
  };
}

export const smtpSchema = z.object({
  host: z.string().trim().min(1, 'Enter the SMTP server.').max(200),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().min(1, 'Enter the username.').max(200),
  password: z.string().max(500).optional(),
  fromName: z.string().trim().max(100).default(''),
  fromEmail: z.email('Enter the address emails come from.'),
});

export async function saveSmtp(req, input) {
  const existing = await Integration.findOne({ workspace: req.workspace._id, type: 'smtp', user: null }).select('+secret');
  const password = input.password || (existing ? decrypt(existing.secret) : '');
  if (!password) throw ApiError.badRequest('Some fields need attention.', [{ field: 'password', message: 'Enter the password.' }]);

  if (!env.dryRun) {
    const transport = nodemailer.createTransport({ host: input.host, port: input.port, secure: input.secure, auth: { user: input.user, pass: password }, connectionTimeout: 10000 });
    try {
      await transport.verify();
    } catch (error) {
      throw ApiError.badRequest(`Could not sign in to ${input.host}: ${error.message}`);
    }
  }

  const { password: _drop, ...config } = input;
  const row = await Integration.findOneAndUpdate(
    { workspace: req.workspace._id, type: 'smtp', user: null },
    { $set: { account: input.fromEmail, config, secret: encrypt(password), status: 'connected', lastError: '', connectedBy: req.user._id } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  await audit(req, { action: 'integrations.smtp', module: 'settings', summary: `Connected SMTP (${input.host})` });
  return publicIntegration(row);
}

export const whatsappSchema = z.object({
  phoneNumberId: z.string().regex(/^\d{5,30}$/, 'The phone number ID is the long number from Meta, not the phone number.'),
  accessToken: z.string().min(20).max(1000).optional(),
  templateName: z.string().regex(/^[a-z0-9_]{1,512}$/, 'Template names are lower-case letters, digits and _.'),
  templateLanguage: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'Use a language code like en or en_US.').default('en'),
});

export async function saveWhatsapp(req, input) {
  const existing = await Integration.findOne({ workspace: req.workspace._id, type: 'whatsapp_cloud', user: null }).select('+secret');
  const token = input.accessToken || (existing ? decrypt(existing.secret) : '');
  if (!token) throw ApiError.badRequest('Some fields need attention.', [{ field: 'accessToken', message: 'Paste the access token.' }]);

  let account = input.phoneNumberId;
  if (!env.dryRun) {
    const res = await fetch(`${graph(input.phoneNumberId)}?fields=display_phone_number,verified_name`, { headers: { authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw ApiError.badRequest(`Meta did not accept these details: ${body.error?.message ?? res.status}`);
    account = `${body.verified_name ?? ''} ${body.display_phone_number ?? ''}`.trim();
  }

  const { accessToken: _drop, ...config } = input;
  const row = await Integration.findOneAndUpdate(
    { workspace: req.workspace._id, type: 'whatsapp_cloud', user: null },
    { $set: { account, config, secret: encrypt(token), status: 'connected', lastError: '', connectedBy: req.user._id } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  await audit(req, { action: 'integrations.whatsapp', module: 'settings', summary: 'Connected WhatsApp Business' });
  return publicIntegration(row);
}

export async function removeIntegration(req, id) {
  const row = await Integration.findOne({ _id: id, workspace: req.workspace._id }).select('+secret');
  if (!row) throw ApiError.notFound('Integration not found.');
  const isOwnMailbox = row.type === 'gmail' && String(row.user) === String(req.user._id);
  if (!isOwnMailbox && !can(req.workspace, req.member, 'settings', 'edit')) {
    throw ApiError.forbidden(row.type === 'gmail'
      ? 'Only the person who connected this Gmail account, or someone who manages settings, can disconnect it.'
      : 'Your role cannot change integrations.');
  }
  if (row.type === 'gmail' && !env.dryRun && row.secret) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(row.secret))}`, { method: 'POST' }).catch(() => {});
  }
  await row.deleteOne();
  await audit(req, { action: 'integrations.removed', module: 'settings', summary: `Disconnected ${row.type}` });
}

// ── Gmail OAuth ───────────────────────────────────────────────────────────────

export function gmailAuthUrl(state) {
  if (!env.gmailEnabled) throw ApiError.notFound('Gmail sending is not configured on this server.');
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function completeGmail({ code, workspaceId, userId }) {
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: env.GOOGLE_REDIRECT_URI, grant_type: 'authorization_code' }),
  });
  const tokens = await res.json();
  if (!res.ok) throw new Error(tokens.error_description ?? tokens.error ?? 'Google refused the sign-in.');
  if (!String(tokens.scope ?? '').includes('gmail.send')) throw new Error('Permission to send email was not granted. Tick the box on Google\'s screen and try again.');
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove Finvoice from your Google account permissions and connect again.');

  // Received directly from Google's token endpoint over TLS, so the payload is used for display only.
  const claims = JSON.parse(Buffer.from(String(tokens.id_token).split('.')[1] ?? '', 'base64url').toString() || '{}');

  await Integration.findOneAndUpdate(
    { workspace: workspaceId, type: 'gmail', user: userId },
    { $set: { account: claims.email ?? '', secret: encrypt(tokens.refresh_token), status: 'connected', lastError: '', connectedBy: userId, config: {} } },
    { upsert: true },
  );
}

async function gmailAccessToken(integration) {
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: decrypt(integration.secret), grant_type: 'refresh_token' }),
  });
  const body = await res.json();
  if (!res.ok) {
    await Integration.updateOne({ _id: integration._id }, { status: 'error', lastError: body.error_description ?? body.error ?? 'Token refresh failed' });
    throw ApiError.badRequest('Your Gmail connection has expired. Reconnect Gmail in Settings → Integrations.');
  }
  return body.access_token;
}

// ── sending ───────────────────────────────────────────────────────────────────

export const sendSchema = z.object({
  channel: z.enum(['gmail', 'smtp', 'whatsapp_link', 'whatsapp_cloud']),
  to: z.string().trim().max(320).default(''),
  cc: z.array(z.email()).max(10).default([]),
  subject: z.string().trim().max(300).optional(),
  message: z.string().max(5000).optional(),
  attachPdf: z.boolean().default(true),
});

const MODELS = { invoices: Invoice, quotations: Quotation };

async function buildMime({ from, to, cc, subject, text, attachment }) {
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2328">${text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>')}</div>`;
  const composer = new MailComposer({ from, to, cc, subject, text, html, attachments: attachment ? [attachment] : [] });
  return composer.compile().build();
}

export async function sendDocument(req, kind, id, input) {
  const { document } = await documents.get(req, kind, id);
  if (kind === 'invoices' && document.status === 'draft') throw ApiError.conflict('Issue this invoice before sending it — a draft has no number yet.');
  if (document.status === 'void') throw ApiError.conflict('A void invoice cannot be sent.');

  const ws = req.workspace;
  const composed = composeFor(ws, kind, document);
  const subject = input.subject || composed.subject;
  const channel = input.channel;
  const log = { workspace: ws._id, kind, document: document._id, channel, subject, sentBy: req.user._id, sentByName: req.member.name || req.user.displayName };

  const result = { channel };
  try {
    if (channel === 'whatsapp_link') {
      const phone = normalisePhone(input.to || document.billTo?.phone);
      const text = input.message || composed.whatsapp;
      result.url = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
      await DeliveryLog.create({ ...log, to: phone ?? '', status: 'prepared' });
    } else if (channel === 'gmail' || channel === 'smtp') {
      const to = input.to || document.billTo?.email;
      if (!z.email().safeParse(to).success) throw ApiError.badRequest('Some fields need attention.', [{ field: 'to', message: 'Enter the customer\'s email address.' }]);

      const integration = await Integration.findOne(channel === 'gmail'
        ? { workspace: ws._id, type: 'gmail', user: req.user._id }
        : { workspace: ws._id, type: 'smtp', user: null }).select('+secret');
      if (!integration) throw ApiError.badRequest(channel === 'gmail' ? 'Connect your Gmail account in Settings → Integrations first.' : 'Set up SMTP in Settings → Integrations first.');

      const pdfInput = input.attachPdf ? await renderInput(ws, kind, document) : null;
      const attachment = pdfInput ? { filename: pdfFilename(kind, document, ws), content: env.dryRun ? Buffer.from('%PDF-1.7 dry run') : await toPdf(pdfInput), contentType: 'application/pdf' } : null;
      const text = input.message || composed.body;
      const fromName = channel === 'smtp' ? integration.config.fromName || ws.name : ws.name;
      const fromEmail = channel === 'smtp' ? integration.config.fromEmail : integration.account;
      const from = { name: fromName, address: fromEmail };

      if (channel === 'gmail') {
        const raw = await buildMime({ from, to, cc: input.cc, subject, text, attachment });
        if (env.dryRun) {
          log.preview = { raw: raw.toString('utf8').slice(0, 4000), size: raw.length };
        } else {
          const res = await fetch(GMAIL_SEND, { method: 'POST', headers: { authorization: `Bearer ${await gmailAccessToken(integration)}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw: raw.toString('base64url') }) });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error?.message ?? `Gmail answered ${res.status}`);
          log.providerId = body.id ?? '';
        }
      } else {
        const transport = env.dryRun
          ? nodemailer.createTransport({ streamTransport: true, buffer: true })
          : nodemailer.createTransport({ host: integration.config.host, port: integration.config.port, secure: integration.config.secure, auth: { user: integration.config.user, pass: decrypt(integration.secret) } });
        const info = await transport.sendMail({ from, to, cc: input.cc, subject, text, attachments: attachment ? [attachment] : [] });
        if (env.dryRun) log.preview = { raw: info.message.toString('utf8').slice(0, 4000) };
        log.providerId = info.messageId ?? '';
      }
      log.to = to;
      await DeliveryLog.create({ ...log, status: 'sent' });
    } else {
      const phone = normalisePhone(input.to || document.billTo?.phone);
      if (!phone) throw ApiError.badRequest('Some fields need attention.', [{ field: 'to', message: 'Enter a WhatsApp number with its country code.' }]);
      const integration = await Integration.findOne({ workspace: ws._id, type: 'whatsapp_cloud', user: null }).select('+secret');
      if (!integration) throw ApiError.badRequest('Connect WhatsApp Business in Settings → Integrations first.');
      const token = decrypt(integration.secret);
      const { phoneNumberId, templateName, templateLanguage } = integration.config;
      const ctx = messageContext(ws, kind, document);
      const filename = pdfFilename(kind, document, ws);

      let mediaId = 'dry-run-media';
      if (!env.dryRun) {
        const pdf = await toPdf(await renderInput(ws, kind, document));
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('type', 'application/pdf');
        form.append('file', new Blob([pdf], { type: 'application/pdf' }), filename);
        const upload = await fetch(graph(`${phoneNumberId}/media`), { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
        const uploaded = await upload.json().catch(() => ({}));
        if (!upload.ok) throw new Error(uploaded.error?.message ?? `Meta answered ${upload.status}`);
        mediaId = uploaded.id;
      }

      const payload = {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: templateLanguage },
          components: [
            { type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename } }] },
            { type: 'body', parameters: [ctx['customer.name'] || 'there', `${ctx['document.Label']} ${ctx['document.number']}`, ctx['document.total']].map((text) => ({ type: 'text', text })) },
          ],
        },
      };
      if (env.dryRun) {
        log.preview = payload;
      } else {
        const res = await fetch(graph(`${phoneNumberId}/messages`), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error?.message ?? `Meta answered ${res.status}`);
        log.providerId = body.messages?.[0]?.id ?? '';
      }
      log.to = phone;
      await DeliveryLog.create({ ...log, status: 'sent' });
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.warn('document delivery failed', { channel, message: error.message });
    await DeliveryLog.create({ ...log, to: input.to ?? '', status: 'failed', error: error.message.slice(0, 500) });
    throw new ApiError(502, 'delivery_failed', `Sending failed: ${error.message}`);
  }

  // A quotation that has gone out is "sent"; an invoice records when it first went.
  const Model = MODELS[kind];
  const update = { $set: { sentAt: document.sentAt ?? new Date() } };
  if (kind === 'quotations' && document.status === 'draft') update.$set.status = 'sent';
  await Model.updateOne({ _id: document._id, workspace: ws._id }, update);

  await audit(req, { action: `${kind}.sent`, module: kind, recordId: document._id, summary: `Sent ${document.number} by ${channel.replace('_', ' ')}` });
  return result;
}

export const deliveriesFor = (req, id) => DeliveryLog.find({ workspace: req.workspace._id, document: id }).select('-preview').sort({ createdAt: -1 }).limit(50).lean();

export const messagesFor = (req, kind, document) => composeFor(req.workspace, kind, document);
