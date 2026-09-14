/**
 * Carries a federated sign-in across the round trip to Google/Microsoft/LinkedIn.
 *
 * Everything needed to finish the flow rides in one short-lived signed,
 * httpOnly cookie: the CSRF `state`, the ID token `nonce`, the PKCE verifier,
 * and where to go afterwards. Keeping it in a cookie rather than a server-side
 * store means a user who abandons a sign-in leaves nothing behind.
 */
const COOKIE = 'texor_fed';
const TTL_MS = 10 * 60 * 1000;

export function saveTransaction(res, data, { secure }) {
  res.cookie(COOKIE, JSON.stringify(data), {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: TTL_MS,
  });
}

export function readTransaction(req) {
  const raw = req.signedCookies?.[COOKIE];
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearTransaction(res, { secure }) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
}
