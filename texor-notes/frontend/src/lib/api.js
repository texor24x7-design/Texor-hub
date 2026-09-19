/**
 * Client for the Texor Notes API.
 *
 * Identical in shape to the one in every other Texor product — same ApiError,
 * same credentials handling — so moving between product codebases does not mean
 * relearning how the frontend talks to its backend.
 */
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4004';

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      this.details.filter((detail) => detail.field).map((detail) => [detail.field, detail.message]),
    );
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let response;

  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach Texor Notes right now. Check your connection and try again.', {
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

/** Sign-in is a full browser navigation, not a fetch — see the backend notes. */
export const signInWithTexor = (returnTo = '/notes') => {
  window.location.href = `${API_ORIGIN}/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
};

export const auth = {
  me: () => api('/api/auth/me'),
  async logout() {
    const { redirectTo } = await api('/api/auth/logout', { method: 'POST' });
    window.location.href = redirectTo;
  },
};

/**
 * Meetings.
 *
 * `join` is the only call that returns anything the browser can open a room
 * with, and it answers one of two ways — `admitted` with a media grant, or
 * `waiting` with a knock to poll. Everything else here is bookkeeping around
 * that one decision.
 */
export const notes = {
  list: (params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== '' && value != null),
    );
    return api(`/api/notes${query.size ? `?${query}` : ''}`);
  },
  get: (id) => api(`/api/notes/${id}`),
  create: (body) => api('/api/notes', { method: 'POST', body }),
  save: (id, body) => api(`/api/notes/${id}`, { method: 'PATCH', body }),
  remove: (id) => api(`/api/notes/${id}`, { method: 'DELETE' }),
  restore: (id) => api(`/api/notes/${id}/restore`, { method: 'POST' }),
  purge: (id) => api(`/api/notes/${id}/purge`, { method: 'DELETE' }),

  setLabels: (id, labels) => api(`/api/notes/${id}/labels`, { method: 'PUT', body: { labels } }),

  share: (id, body) => api(`/api/notes/${id}/shares`, { method: 'POST', body }),
  unshare: (id, email) =>
    api(`/api/notes/${id}/shares/${encodeURIComponent(email)}`, { method: 'DELETE' }),

  activity: (id) => api(`/api/notes/${id}/activity`),
};

export const labels = {
  list: () => api('/api/labels'),
  create: (body) => api('/api/labels', { method: 'POST', body }),
  save: (id, body) => api(`/api/labels/${id}`, { method: 'PATCH', body }),
  remove: (id) => api(`/api/labels/${id}`, { method: 'DELETE' }),

  share: (id, body) => api(`/api/labels/${id}/shares`, { method: 'POST', body }),
  unshare: (id, email) =>
    api(`/api/labels/${id}/shares/${encodeURIComponent(email)}`, { method: 'DELETE' }),
};

/**
 * Who this person can share with or tag.
 *
 * Not a directory — the backend will not enumerate anybody. It answers with
 * people you already share something with, and resolves an exact address so a
 * first share can still be sent.
 */
export const people = {
  search: (q) => api(`/api/people?q=${encodeURIComponent(q ?? '')}`),
};

export const keys = {
  list: () => api('/api/keys'),
  create: (body) => api('/api/keys', { method: 'POST', body }),
  revoke: (id) => api(`/api/keys/${id}`, { method: 'DELETE' }),
};

/** Apps this person has let write into their account. */
export const connections = {
  list: () => api('/api/connections'),
  revoke: (id) => api(`/api/connections/${id}`, { method: 'DELETE' }),

  prompt: (app, redirectUri) =>
    api(`/api/connect?app=${encodeURIComponent(app)}&redirect_uri=${encodeURIComponent(redirectUri)}`),
  approve: (body) => api('/api/connect', { method: 'POST', body }),
};
