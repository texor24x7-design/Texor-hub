/**
 * Client for the Finvoice API.
 *
 * Identical in shape to the one in every other Texor product — same ApiError,
 * same credentials handling — so moving between product codebases does not mean
 * relearning how the frontend talks to its backend.
 */
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4001';

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
    throw new ApiError('Cannot reach Finvoice right now. Check your connection and try again.', {
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
export const signInWithTexor = (returnTo = '/invoices') => {
  window.location.href = `${API_ORIGIN}/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
};

export const auth = {
  me: () => api('/api/auth/me'),
  async logout() {
    const { redirectTo } = await api('/api/auth/logout', { method: 'POST' });
    window.location.href = redirectTo;
  },
};

export const invoices = {
  list: (params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== '' && value !== undefined),
    );
    return api(`/api/invoices${query.size ? `?${query}` : ''}`);
  },
  get: (id) => api(`/api/invoices/${id}`),
  create: (body) => api('/api/invoices', { method: 'POST', body }),
  update: (id, body) => api(`/api/invoices/${id}`, { method: 'PATCH', body }),
  remove: (id) => api(`/api/invoices/${id}`, { method: 'DELETE' }),
  summary: () => api('/api/summary'),
};
