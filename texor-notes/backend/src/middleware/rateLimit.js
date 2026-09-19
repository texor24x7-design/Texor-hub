import ApiError from '../utils/ApiError.js';

/**
 * Fixed-window rate limiting.
 *
 * Lifted from Finvoice, which needed it for its public document routes. Here it
 * is the notes API that needs it: a key is a credential handed to somebody
 * else's software, and somebody else's software is where a retry loop with no
 * backoff lives.
 *
 * ponytail: counters live in this process's memory, so a limit is per-instance
 * and resets on restart. That is the right trade while Notes runs as one API
 * process; put the counter in Mongo (or Redis) before running several behind a
 * load balancer, or each one will allow the full quota.
 */
const buckets = new Map();
let writes = 0;

/** Returns seconds to wait, or 0 when the caller is within their allowance. */
function hit(key, limit, windowMs) {
  const now = Date.now();

  // Sweeping as we write keeps the map bounded without owning a timer.
  writes += 1;
  if (writes % 5000 === 0) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 0;
  }
  bucket.count += 1;
  return bucket.count > limit ? Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) : 0;
}

/**
 * An API key is limited as itself, not as the account behind it.
 *
 * Somebody with three integrations should not have their CRM knocked offline
 * because a script they wrote at the weekend is in a retry loop. A signed-in
 * person is limited as themselves, so one noisy user on a shared office IP
 * cannot lock out their colleagues; everyone else is limited by IP.
 */
const identify = (req) => {
  if (req.apiKey) return `k:${req.apiKey._id}`;
  if (req.user) return `u:${req.user._id}`;
  return `ip:${req.ip}`;
};

export function rateLimit({ name, limit, windowMs = 60_000, message }) {
  return function limiter(req, res, next) {
    const retryAfter = hit(`${name}:${identify(req)}`, limit, windowMs);
    if (!retryAfter) return next();
    res.set('Retry-After', String(retryAfter));
    next(ApiError.tooManyRequests(message ?? `Too many requests. Try again in ${retryAfter}s.`));
  };
}

/** Test seam: the suites need a clean slate between cases. */
export const __reset = () => { buckets.clear(); writes = 0; };

export default rateLimit;
