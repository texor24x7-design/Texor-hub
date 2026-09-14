/**
 * Errors that are safe to render to an API client.
 *
 * Anything thrown that is *not* an ApiError is treated as unexpected by the
 * error middleware and reported to the caller as a generic 500.
 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError(400, 'bad_request', message, details);
  }

  static unauthorized(message = 'Authentication required.') {
    return new ApiError(401, 'unauthorized', message);
  }

  static forbidden(message = 'You do not have access to this resource.') {
    return new ApiError(403, 'forbidden', message);
  }

  static notFound(message = 'Not found.') {
    return new ApiError(404, 'not_found', message);
  }

  static conflict(message, details) {
    return new ApiError(409, 'conflict', message, details);
  }

  static tooManyRequests(message = 'Too many requests. Try again shortly.') {
    return new ApiError(429, 'rate_limited', message);
  }
}

export default ApiError;
