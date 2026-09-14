/**
 * Outbound transactional email.
 *
 * One `send()` for the whole application, behind a transport chosen at boot:
 *
 *   resend   the real thing, whenever RESEND_API_KEY is set
 *   console  development fallback that prints the message instead of sending
 *
 * The fallback matters: without it, a developer with no Resend account cannot
 * verify an email address locally, and the sign-up flow is untestable. The link
 * is printed in full so it can be pasted straight into a browser.
 *
 * Resend's REST API is a single POST, so it is called directly rather than
 * through the SDK — one less dependency to keep current, and full control over
 * how failures are surfaced.
 */
import env from '../config/env.js';
import logger from '../utils/logger.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export class MailError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'MailError';
    this.cause = cause;
  }
}

async function sendViaResend({ to, subject, html, text }) {
  let response;

  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [to],
        subject,
        html,
        text,
        ...(env.MAIL_REPLY_TO ? { reply_to: env.MAIL_REPLY_TO } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (cause) {
    throw new MailError('Could not reach the email service.', { cause });
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    // Resend's own wording is useful in logs but means nothing to the person
    // waiting for the email, so callers translate it.
    logger.error('resend rejected an email', {
      status: response.status,
      name: payload.name,
      message: payload.message,
    });
    throw new MailError(payload.message ?? `Email service returned HTTP ${response.status}`);
  }

  return { id: payload.id, transport: 'resend' };
}

function sendViaConsole({ to, subject, text }) {
  const rule = '─'.repeat(72);
  console.log(`\n${rule}\n  EMAIL (not sent — RESEND_API_KEY is not set)\n  to:      ${to}\n  subject: ${subject}\n${rule}\n${text}\n${rule}\n`);
  return { id: `console-${Date.now()}`, transport: 'console' };
}

export async function sendMail(message) {
  if (!env.mailEnabled) return sendViaConsole(message);

  const result = await sendViaResend(message);
  logger.info('email sent', { to: message.to, subject: message.subject, id: result.id });
  return result;
}

export default sendMail;
