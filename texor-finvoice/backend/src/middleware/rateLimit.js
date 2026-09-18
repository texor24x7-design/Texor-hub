import ApiError from '../utils/ApiError.js';

/**
 * Fixed-window rate limiting.
 *
 * The expensive endpoints here are not expensive in the usual way. Rendering a
 * PDF spawns work in a shared Chromium, and the public document and file routes
 * carry no session at all, so without a limit a single caller can occupy the
 * renderer indefinitely and nothing upstream would stop them.
 *
 * ponytail: counters live in this process's memory, so a limit is per-instance
 * and resets on restart. That is the right trade while Finvoice runs as one API
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
 * A signed-in caller is limited as themselves, so one noisy user on a shared
 * office IP cannot lock out their colleagues. Everyone else is limited by IP.
 */
const identify = (req) => (req.user ? `u:${req.user._id}` : `ip:${req.ip}`);

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
