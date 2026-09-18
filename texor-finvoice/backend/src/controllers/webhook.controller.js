/**
 * Inbound webhooks. Razorpay tells us a customer paid; this is the only place
 * money is recorded without a person doing it, so it is deliberately strict:
 * the signature must verify, the invoice must belong to that workspace, and the
 * same Razorpay payment can never be recorded twice however often it retries.
 */
import Payment from '../models/Payment.js';
import Workspace from '../models/Workspace.js';
import logger from '../utils/logger.js';
import * as documents from '../services/document.service.js';
import { ONLINE_MODE, findIntegration, readEvent, secretsOf, verifySignature } from '../services/razorpay.service.js';

const PAID_EVENTS = new Set(['payment_link.paid', 'payment.captured']);

export async function razorpay(req, res) {
  // Always 200 once the signature is good: a retry storm helps nobody, and
  // anything we could not act on is logged for a human instead.
  const workspace = await Workspace.findOne({ slug: String(req.params.workspace ?? '').toLowerCase() }).lean();
  if (!workspace) return res.status(404).json({ ok: false });

  const integration = await findIntegration(workspace._id);
  if (!integration) return res.status(404).json({ ok: false });
  const { webhookSecret } = secretsOf(integration);

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  if (!verifySignature(raw, req.get('x-razorpay-signature'), webhookSecret)) {
    logger.warn('razorpay webhook signature rejected', { workspace: workspace.slug });
    return res.status(401).json({ ok: false });
  }

  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ ok: false }); }

  const { event, invoiceId, paymentId, amountMinor, method } = readEvent(body);
  if (!PAID_EVENTS.has(event) || !invoiceId || !paymentId || amountMinor <= 0) return res.json({ ok: true, ignored: true });

  // Razorpay retries until it gets a 2xx, so this is the guard that matters.
  const already = await Payment.findOne({ workspace: workspace._id, reference: paymentId }).lean();
  if (already) return res.json({ ok: true, duplicate: true });

  const ctx = {
    workspace,
    user: { _id: integration.connectedBy ?? null },
    member: { role: 'owner', name: 'Razorpay', status: 'active' },
    ip: req.ip ?? '',
  };

  try {
    await documents.recordPayment(ctx, invoiceId, {
      amountMinor,
      mode: ONLINE_MODE,
      reference: paymentId,
      note: [method, event].filter(Boolean).join(' · ').slice(0, 200),
    });
  } catch (error) {
    // A closed or already-settled invoice is not worth retrying for.
    logger.warn('razorpay payment could not be recorded', { workspace: workspace.slug, invoice: invoiceId, message: error.message });
    return res.json({ ok: true, unrecorded: true });
  }
  return res.json({ ok: true });
}
