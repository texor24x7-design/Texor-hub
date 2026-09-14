/**
 * Carries the PKCE verifier, state and nonce across the round trip to Texor.
 *
 * These three values must come back from the same browser that started the
 * sign-in, and must not be readable by page scripts — so they ride in a short
 * signed, httpOnly cookie rather than in a server-side store. Nothing sensitive
 * about the *user* is in here; it is single-use and expires in ten minutes.
 */
const COOKIE = 'texor_tx';
const TTL_MS = 10 * 60 * 1000;

export function saveTransaction(res, { state, nonce, codeVerifier, returnTo }, { secure }) {
  res.cookie(COOKIE, JSON.stringify({ state, nonce, codeVerifier, returnTo }), {
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
