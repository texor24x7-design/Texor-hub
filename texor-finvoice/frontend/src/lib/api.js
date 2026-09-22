/**
 * Client for the Finvoice API.
 *
 * Identical in shape to the one in every other Texor product — same ApiError,
 * same credentials handling — so moving between product codebases does not mean
 * relearning how the frontend talks to its backend.
 */
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4001';
export const ACCOUNTS_ORIGIN = process.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN ?? '';

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

export async function api(path, { method = 'GET', body, headers, raw = false, signal } = {}) {
  let response;
  const isBinary = body instanceof Blob || body instanceof ArrayBuffer;

  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      method,
      credentials: 'include',
      signal,
      headers: { ...(body && !isBinary ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? (isBinary ? body : JSON.stringify(body)) : undefined,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach Finvoice right now. Check your connection and try again.', {
      code: 'network_error',
    });
  }

  if (raw && response.ok) return response;
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
export const signInWithTexor = (returnTo = '/start') => {
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
 * An uploaded file, by its key — or an absolute URL passed straight through.
 * A picture from a Texor Account is already a URL (Google serves avatars off
 * lh3.googleusercontent.com), and treating one as a file key builds
 * `/api/files/https%3A%2F%2F…`, which 404s.
 */
export const fileUrl = (key) => (!key ? null : /^https?:\/\//i.test(key) ? key : `${API_ORIGIN}/api/files/${encodeURIComponent(key)}`);

/** Everything under one workspace. */
export function workspaceApi(slug) {
  const base = `/api/w/${encodeURIComponent(slug)}`;
  const call = (path, options) => api(`${base}${path}`, options);
  const query = (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));
    return q.size ? `?${q}` : '';
  };

  return {
    base,
    url: (path) => `${API_ORIGIN}${base}${path}`,
    get: (path, params) => call(`${path}${query(params)}`),
    post: (path, body) => call(path, { method: 'POST', body: body ?? {} }),
    put: (path, body) => call(path, { method: 'PUT', body }),
    patch: (path, body) => call(path, { method: 'PATCH', body }),
    del: (path) => call(path, { method: 'DELETE' }),
    text: async (path) => (await call(path, { raw: true })).text(),

    /**
     * A file posted as the raw body to an endpoint that reads it rather than
     * stores it — a spreadsheet being imported, say. The server decides what it
     * is from the bytes, so a browser's guess at the content type is only a hint.
     */
    sendFile: (path, file) => call(path, {
      method: 'POST',
      body: file,
      headers: { 'content-type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name ?? 'upload') },
    }),

    /**
     * Images are downscaled in the browser before they are sent, so a 12 MB
     * phone photo arrives as a few hundred KB and the upload limit is about
     * documents, not cameras.
     */
    async upload(file, purpose = 'attachment', { maxSide = 1600 } = {}) {
      let blob = file;
      let type = file.type;
      if (/^image\/(png|jpeg|webp)$/.test(type) && maxSide) {
        const bitmap = await createImageBitmap(file).catch(() => null);
        if (bitmap && Math.max(bitmap.width, bitmap.height) > maxSide) {
          const scale = maxSide / Math.max(bitmap.width, bitmap.height);
          const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
          canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          type = type === 'image/png' ? 'image/png' : 'image/jpeg';
          blob = await canvas.convertToBlob({ type, quality: 0.88 });
        }
      }
      return call(`/files?purpose=${encodeURIComponent(purpose)}`, {
        method: 'POST', body: blob, headers: { 'content-type': type, 'x-filename': encodeURIComponent(file.name ?? 'upload') },
      });
    },
  };
}
