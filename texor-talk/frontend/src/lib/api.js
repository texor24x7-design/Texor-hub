/**
 * Client for the Texor Talk API.
 *
 * Identical in shape to the one in every other Texor product — same ApiError,
 * same credentials handling — so moving between product codebases does not mean
 * relearning how the frontend talks to its backend.
 */
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4002';

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
    throw new ApiError('Cannot reach Texor Talk right now. Check your connection and try again.', {
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
export const signInWithTexor = (returnTo = '/home') => {
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
export const meetings = {
  list: (scope = 'upcoming') => api(`/api/meetings?scope=${scope}`),
  get: (code) => api(`/api/meetings/${code}`),
  create: (body) => api('/api/meetings', { method: 'POST', body }),
  // The org rules a new meeting will be bound by, before there is a meeting.
  defaults: () => api('/api/meetings/defaults'),
  update: (code, body) => api(`/api/meetings/${code}`, { method: 'PATCH', body }),
  cancel: (code) => api(`/api/meetings/${code}`, { method: 'DELETE' }),

  join: (code) => api(`/api/meetings/${code}/join`, { method: 'POST' }),
  knockStatus: (code, knockId) => api(`/api/meetings/${code}/knocks/${knockId}/status`),
  cancelKnock: (code, knockId) => api(`/api/meetings/${code}/knocks/${knockId}`, { method: 'DELETE' }),
  knocks: (code) => api(`/api/meetings/${code}/knocks`),
  decideKnock: (code, knockId, decision) =>
    api(`/api/meetings/${code}/knocks/${knockId}`, { method: 'POST', body: { decision } }),

  heartbeat: (code) => api(`/api/meetings/${code}/heartbeat`, { method: 'POST' }),
  leave: (code) => api(`/api/meetings/${code}/leave`, { method: 'POST' }),
  end: (code) => api(`/api/meetings/${code}/end`, { method: 'POST' }),

  transferHost: (code, texorId) => api(`/api/meetings/${code}/host`, { method: 'POST', body: { texorId } }),

  setRole: (code, texorId, role) =>
    api(`/api/meetings/${code}/participants/${texorId}/role`, { method: 'POST', body: { role } }),
  removeParticipant: (code, texorId) =>
    api(`/api/meetings/${code}/participants/${texorId}`, { method: 'DELETE' }),

  invite: (code, invitees) => api(`/api/meetings/${code}/invitees`, { method: 'POST', body: { invitees } }),
  uninvite: (code, email) =>
    api(`/api/meetings/${code}/invitees/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  rsvp: (code, response) => api(`/api/meetings/${code}/rsvp`, { method: 'POST', body: { response } }),

  // A full navigation rather than a fetch: the response is a file download, and
  // the browser's own download handling is what should receive it.
  inviteUrl: (code) => `${API_ORIGIN}/api/meetings/${code}/invite.ics`,

  /**
   * Guest access. These two are the only meeting calls that work with no
   * credential at all — everything else needs a Texor session or a guest pass
   * for that specific meeting.
   */
  guestPreview: (code) => api(`/api/meetings/${code}/guest`),
  joinAsGuest: (code, name) => api(`/api/meetings/${code}/guest`, { method: 'POST', body: { name } }),
  leaveAsGuest: (code) => api(`/api/meetings/${code}/guest/leave`, { method: 'POST' }),
};

/**
 * Meeting notes.
 *
 * `save` is called while somebody is typing, so it sends the whole document
 * every time rather than a patch. Merging two half-documents from racing saves
 * is how an editor loses a paragraph, and a note is small enough that sending
 * all of it costs nothing.
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

  // Who can be tagged, for a note that does not exist yet.
  people: (code) => api(`/api/meetings/${code}/people`),
};

export const admin = {
  policy: () => api('/api/admin/policy'),
  savePolicy: (body) => api('/api/admin/policy', { method: 'PUT', body }),
  audit: (params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== '' && value != null),
    );
    return api(`/api/admin/audit${query.size ? `?${query}` : ''}`);
  },
  verifyAudit: () => api('/api/admin/audit/verify'),
  meetings: (status = 'live') => api(`/api/admin/meetings?status=${status}`),
};

export const channels = {
  list: () => api('/api/channels'),
  get: (id) => api(`/api/channels/${id}`),
  create: (body) => api('/api/channels', { method: 'POST', body }),
  join: (id) => api(`/api/channels/${id}/join`, { method: 'POST' }),
  leave: (id) => api(`/api/channels/${id}/leave`, { method: 'POST' }),
  messages: (id, params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== '' && value !== undefined),
    );
    return api(`/api/channels/${id}/messages${query.size ? `?${query}` : ''}`);
  },
  post: (id, body) => api(`/api/channels/${id}/messages`, { method: 'POST', body }),
  removeMessage: (id, messageId) => api(`/api/channels/${id}/messages/${messageId}`, { method: 'DELETE' }),
};
