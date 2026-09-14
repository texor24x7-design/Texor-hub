/**
 * Thin client for the Texor Account API.
 *
 * Every call sends cookies (`credentials: 'include'`) because the whole session
 * model — both the SSO session and the OIDC interaction binding — lives in
 * cookies. Failures are normalised into an ApiError so screens can render
 * `error.message` directly and read `error.fieldErrors` for inline messages.
 */
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** `{ email: 'Enter a valid email address.' }` for inline form errors. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      this.details
        .filter((detail) => detail.field)
        .map((detail) => [detail.field, detail.message]),
    );
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let response;

  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      method,
      credentials: 'include',
      signal,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach Texor right now. Check your connection and try again.', {
      code: 'network_error',
    });
  }

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(error.message ?? 'Something went wrong.', {
      status: response.status,
      code: error.code,
      details: error.details,
    });
  }

  return payload;
}

export const auth = {
  me: () => api('/api/auth/me'),
  // Which of Google / Microsoft / LinkedIn this deployment has configured.
  providers: () => api('/api/auth/providers'),
  signup: (body) => api('/api/auth/signup', { method: 'POST', body }),
  login: (body) => api('/api/auth/login', { method: 'POST', body }),
  logout: () => api('/api/auth/logout', { method: 'POST' }),
  endSessionUrl: () => api('/api/auth/end-session-url'),

  // Confirming an address and recovering a password both work without a
  // session — the link in the inbox is the credential.
  verifyEmail: (token) => api('/api/auth/verify-email', { method: 'POST', body: { token } }),
  forgotPassword: (email) => api('/api/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token, newPassword) =>
    api('/api/auth/reset-password', { method: 'POST', body: { token, newPassword } }),
};

export const interaction = {
  details: (uid) => api(`/api/interaction/${uid}`),
  login: (uid, body) => api(`/api/interaction/${uid}/login`, { method: 'POST', body }),
  confirm: (uid, body) => api(`/api/interaction/${uid}/confirm`, { method: 'POST', body }),
  abort: (uid) => api(`/api/interaction/${uid}/abort`, { method: 'POST' }),
};

/**
 * The developer console — registering apps that sign in with Texor.
 *
 * Open to any signed-in account; ownership is enforced per app on the server.
 */
export const console_ = {
  scopes: () => api('/api/console/scopes'),
  listApps: () => api('/api/console/apps'),
  createApp: (body) => api('/api/console/apps', { method: 'POST', body }),
  getApp: (clientId) => api(`/api/console/apps/${clientId}`),
  updateApp: (clientId, body) => api(`/api/console/apps/${clientId}`, { method: 'PATCH', body }),
  deleteApp: (clientId) => api(`/api/console/apps/${clientId}`, { method: 'DELETE' }),
  rotateSecret: (clientId) => api(`/api/console/apps/${clientId}/rotate-secret`, { method: 'POST' }),
  setTestAccounts: (clientId, emails) =>
    api(`/api/console/apps/${clientId}/test-accounts`, { method: 'PUT', body: { emails } }),
  submitForReview: (clientId) =>
    api(`/api/console/apps/${clientId}/submit-review`, { method: 'POST' }),
};

export const account = {
  profile: () => api('/api/account/profile'),
  updateProfile: (body) => api('/api/account/profile', { method: 'PATCH', body }),
  changePassword: (body) => api('/api/account/password', { method: 'POST', body }),
  sessions: () => api('/api/account/sessions'),
  revokeSession: (id) => api(`/api/account/sessions/${id}`, { method: 'DELETE' }),
  revokeOtherSessions: () => api('/api/account/sessions', { method: 'DELETE' }),
  connectedApps: () => api('/api/account/connected-apps'),
  revokeApp: (grantId) => api(`/api/account/connected-apps/${grantId}`, { method: 'DELETE' }),
  identities: () => api('/api/account/identities'),
  unlinkIdentity: (provider) => api(`/api/account/identities/${provider}`, { method: 'DELETE' }),

  sendVerification: () => api('/api/account/send-verification', { method: 'POST' }),

  uploadStatus: () => api('/api/account/picture/status'),
  uploadSignature: () => api('/api/account/picture/signature'),
  savePicture: (body) => api('/api/account/picture', { method: 'PUT', body }),
  removePicture: () => api('/api/account/picture', { method: 'DELETE' }),
};
