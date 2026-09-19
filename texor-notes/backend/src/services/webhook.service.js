/**
 * Telling an app what changed here.
 *
 * The other half of two-way sync. A note that arrived through a key and is then
 * edited in Notes is POSTed back to that app, signed the way Finvoice verifies
 * Razorpay: HMAC-SHA256 over the exact bytes sent, compared in constant time at
 * the other end.
 *
 * Two rules keep this from being a problem:
 *
 *   · **nothing here is awaited by a request.** A note is saved whether or not
 *     somebody else's server is up.
 *   · **a change that arrived from an app is never sent back to it.** Otherwise
 *     the two products hand the same edit to each other until one of them falls
 *     over.
 */
import { createHmac } from 'node:crypto';
import logger from '../utils/logger.js';

const TIMEOUT_MS = 4000;
const ATTEMPTS = 3;

export const sign = (secret, body) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

async function deliver(key, payload) {
  const body = JSON.stringify(payload);

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(key.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-notes-signature': sign(key.webhookSecret, body),
          'x-notes-delivery': String(attempt),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.ok) return true;
      // A 4xx will not become a 2xx by asking again.
      if (response.status < 500) {
        logger.warn('notes webhook refused', { app: key.appName, status: response.status });
        return false;
      }
    } catch (error) {
      if (attempt === ATTEMPTS) {
        logger.warn('notes webhook failed', { app: key.appName, message: error.message });
        return false;
      }
    }

    await new Promise((resolve) => { setTimeout(resolve, attempt * 500); });
  }

  return false;
}

/**
 * Fire and forget, with the catch *inside*.
 *
 * A floating promise that rejects takes the process down under Node's default,
 * and this one rejects every time the other product restarts.
 *
 * ponytail: three attempts in this process, then the change is only in Notes.
 * A delivery collection with a sweep is the upgrade if anybody reports drift.
 */
export function notifyKey(key, payload) {
  if (!key?.webhookUrl || !key.webhookSecret) return;
  deliver(key, payload).catch((error) => logger.warn('notes webhook threw', { message: error.message }));
}

export default { notifyKey, sign };
