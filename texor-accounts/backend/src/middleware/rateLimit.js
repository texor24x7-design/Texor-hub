import rateLimit from 'express-rate-limit';

const json = (message) => (_req, res) => {
  res.status(429).json({ error: { code: 'rate_limited', message } });
};

/** Credential endpoints — tight, because these are the brute-force targets. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: json('Too many attempts. Wait a few minutes and try again.'),
});

/**
 * Anything that sends an email.
 *
 * Tighter than the credential limiter, because the cost of abuse is somebody
 * else's inbox and our sending reputation, not just our CPU.
 */
export const mailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: json('Too many email requests. Wait an hour and try again.'),
});

/** Everything else on /api. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: json('Too many requests. Slow down a little.'),
});
