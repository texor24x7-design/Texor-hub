/**
 * Online payment links, on the business's own Razorpay account.
 *
 * Texor holds no Razorpay credentials: the business pastes its own key id,
 * key secret and webhook secret, exactly as it does for Gmail, SMTP and
 * WhatsApp. Money goes straight to them; Finvoice only learns that it arrived.
 *
 * Payment Links rather than Orders + Checkout, because a link needs no SDK on
 * the customer's page — it is a URL that works in a WhatsApp message.
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import Integration from '../models/Integration.js';
import Invoice from '../models/Invoice.js';
import Workspace from '../models/Workspace.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import env from '../config/env.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { record as audit } from './audit.service.js';
import { amountDue } from './document.service.js';

const API = 'https://api.razorpay.com/v1';

/** The payment mode these land under. Added to the workspace's list on connect. */
export const ONLINE_MODE = 'Online';

export const razorpaySchema = z.object({
  keyId: z.string().trim().regex(/^rzp_(test|live)_[A-Za-z0-9]+$/, 'Key ids look like rzp_live_XXXXXXXX.'),
  keySecret: z.string().trim().max(200).optional(),
  webhookSecret: z.string().trim().max(200).optional(),
});

const secretsOf = (integration) => {
  try { return JSON.parse(decrypt(integration.secret)); } catch { return {}; }
};

const authHeader = (keyId, keySecret) => `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

export async function findIntegration(workspaceId) {
  return Integration.findOne({ workspace: workspaceId, type: 'razorpay', user: null }).select('+secret');
}

export async function save(req, input) {
  const existing = await findIntegration(req.workspace._id);
  const previous = existing ? secretsOf(existing) : {};
  const keySecret = input.keySecret || previous.keySecret;
  const webhookSecret = input.webhookSecret || previous.webhookSecret;
  if (!keySecret) {
    throw ApiError.badRequest('Some fields need attention.', [{ field: 'keySecret', message: 'Enter the key secret the first time.' }]);
  }

  // Prove the keys work before storing them, so a typo is caught here and not
  // by a customer staring at a broken payment page.
  if (!env.dryRun) {
    const res = await fetch(`${API}/payments?count=1`, { headers: { authorization: authHeader(input.keyId, keySecret) } });
    if (res.status === 401) throw ApiError.badRequest('Some fields need attention.', [{ field: 'keySecret', message: 'Razorpay rejected that key id and secret.' }]);
    if (!res.ok) throw new ApiError(502, 'razorpay_unreachable', `Razorpay answered ${res.status}.`);
  }

  const integration = await Integration.findOneAndUpdate(
    { workspace: req.workspace._id, type: 'razorpay', user: null },
    {
      $set: {
        account: input.keyId,
        config: { keyId: input.keyId, hasWebhookSecret: Boolean(webhookSecret) },
        secret: encrypt(JSON.stringify({ keySecret, webhookSecret })),
        status: 'connected',
        lastError: '',
        connectedBy: req.user._id,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );

  // Payments recorded from a webhook need a mode that the workspace accepts.
  await Workspace.updateOne({ _id: req.workspace._id }, { $addToSet: { 'preferences.paymentModes': ONLINE_MODE } });
  await audit(req, { action: 'integrations.razorpay', module: 'settings', summary: 'Connected Razorpay' });
  return { integration: { _id: integration._id, type: 'razorpay', account: integration.account, config: integration.config, status: integration.status } };
}

/** The address the business pastes into Razorpay's webhook settings. */
export const webhookUrl = (workspace) => `${env.apiOrigin}/api/webhooks/razorpay/${workspace.slug}`;

/**
 * Creates (or reuses) a payment link for what an invoice still owes.
 * Reused only while the amount has not moved — a part payment makes a new one.
 */
export async function linkFor(req, invoiceId) {
  const invoice = await Invoice.findOne({ _id: invoiceId, workspace: req.workspace._id, deletedAt: null });
  if (!invoice) throw ApiError.notFound('Invoice not found.');
  if (invoice.status === 'draft') throw ApiError.conflict('Issue this invoice before asking for payment.');
  if (invoice.status === 'void') throw ApiError.conflict('A void invoice cannot be paid.');

  const due = amountDue(invoice);
  if (due <= 0) throw ApiError.conflict('This invoice has nothing left to pay.');
  if (invoice.paymentLink?.url && invoice.paymentLink.amountMinor === due) return { url: invoice.paymentLink.url, reused: true };

  const integration = await findIntegration(req.workspace._id);
  if (!integration) throw ApiError.badRequest('Connect Razorpay in Settings → Integrations first.');
  const { keySecret } = secretsOf(integration);

  let created;
  if (env.dryRun) {
    created = { id: `plink_dry_${invoice._id}`, short_url: `https://rzp.io/i/dry-${invoice._id}` };
  } else {
    const res = await fetch(`${API}/payment_links`, {
      method: 'POST',
      headers: { authorization: authHeader(integration.config.keyId, keySecret), 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: due,
        currency: invoice.currency || 'INR',
        description: `${invoice.number} · ${req.workspace.name}`.slice(0, 250),
        customer: { name: invoice.billTo?.name ?? '', email: invoice.billTo?.email ?? '', contact: invoice.billTo?.phone ?? '' },
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: { invoice: String(invoice._id), workspace: String(req.workspace._id), number: invoice.number ?? '' },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(502, 'razorpay_failed', body.error?.description ?? `Razorpay answered ${res.status}.`);
    created = body;
  }

  invoice.paymentLink = { id: created.id, url: created.short_url, amountMinor: due, createdAt: new Date() };
  await invoice.save();
  await audit(req, { action: 'invoices.payment_link', module: 'invoices', recordId: invoice._id, summary: `Raised a payment link for ${invoice.number}` });
  return { url: created.short_url, reused: false };
}

/** Constant-time check of Razorpay's `x-razorpay-signature` over the raw body. */
export function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Pulls the invoice id, Razorpay payment id and amount out of a webhook body. */
export function readEvent(body) {
  const link = body?.payload?.payment_link?.entity;
  const payment = body?.payload?.payment?.entity;
  const notes = link?.notes ?? payment?.notes ?? {};
  return {
    event: body?.event ?? '',
    invoiceId: notes.invoice ?? null,
    paymentId: payment?.id ?? link?.id ?? null,
    amountMinor: Number(payment?.amount ?? link?.amount_paid ?? 0),
    method: payment?.method ?? '',
  };
}

export async function integrationStatus(workspace) {
  const integration = await Integration.findOne({ workspace: workspace._id, type: 'razorpay', user: null }).lean();
  if (!integration) return null;
  return { connected: true, keyId: integration.config?.keyId ?? '', hasWebhookSecret: Boolean(integration.config?.hasWebhookSecret), webhookUrl: webhookUrl(workspace) };
}

export { secretsOf };
