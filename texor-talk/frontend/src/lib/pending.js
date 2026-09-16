/**
 * Requests waiting for a reply over a socket.
 *
 * Small, and pulled out of `room.js` on purpose: every bug this has had was a
 * lifecycle bug, and `room.js` cannot be loaded outside a browser, so none of
 * them could be reproduced without a meeting, two people and a bad network.
 *
 * ── The one that mattered ──
 *
 * A request was registered here and settled when its reply arrived. When the
 * socket closed instead, nothing settled it: the reply had nowhere to land,
 * and the only thing left holding the promise was its own twenty-second
 * timeout. The client reconnected, the meeting carried on, and long after
 * everything was working again the abandoned timer fired and reported
 * "consume timed out" — an error describing a socket that had closed twenty
 * seconds earlier.
 *
 * So the rule is: every request leaves here exactly once, by reply, by
 * timeout, or by the socket going away. `abort` is the third of those.
 */

/**
 * @param {object} options
 * @param {number} options.timeout  ms before an unanswered request gives up
 * @param {Function} options.setTimer   injectable, so tests need not wait
 * @param {Function} options.clearTimer
 */
export function createPending({
  timeout = 20_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const waiting = new Map();

  return {
    get size() {
      return waiting.size;
    },

    /**
     * Register a request. The promise settles when the reply arrives, when the
     * socket goes, or when the timeout runs out — whichever happens first.
     */
    add(id, action) {
      return new Promise((resolve, reject) => {
        const timer = setTimer(() => {
          if (!waiting.delete(id)) return;
          // Retryable: a server that went quiet is "not right now". The caller
          // reconnects rather than ending a meeting over it.
          reject(Object.assign(new Error(`${action} timed out.`), {
            retryable: true,
            code: 'timeout',
          }));
        }, timeout);

        waiting.set(id, { resolve, reject, timer });
      });
    },

    /**
     * A reply arrived.
     *
     * Returns false for an id nobody is waiting on, which is what a reply that
     * lost a race with a timeout looks like — worth ignoring, not worth
     * throwing over.
     */
    settle(id, message) {
      const entry = waiting.get(id);
      if (!entry) return false;

      waiting.delete(id);
      clearTimer(entry.timer);

      if (message?.ok) entry.resolve(message.data);
      else {
        entry.reject(Object.assign(new Error(message?.error?.message ?? 'The request failed.'), {
          code: message?.error?.code ?? 'error',
        }));
      }

      return true;
    },

    /**
     * The socket went away. Nothing in flight is coming back, so settle it all
     * now rather than leaving each one to its own timer.
     */
    abort(reason) {
      const all = [...waiting.values()];
      waiting.clear();

      for (const entry of all) {
        clearTimer(entry.timer);
        entry.reject(Object.assign(new Error(reason), { retryable: true, code: 'disconnected' }));
      }

      return all.length;
    },
  };
}

export default { createPending };
