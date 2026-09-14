/**
 * Zod-backed request validation.
 *
 * Replaces the validated section of the request in place, so controllers can
 * trust req.body/req.query without re-checking anything.
 */
import ApiError from '../utils/ApiError.js';

export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return next(ApiError.badRequest('Some fields need attention.', details));
  }

  if (source === 'query') {
    // Express 5 exposes req.query through a getter with no setter, so a plain
    // assignment throws. Shadowing it with an own value property keeps every
    // controller reading `req.query` as normal while still handing them the
    // parsed and coerced data.
    Object.defineProperty(req, 'query', {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } else {
    req[source] = result.data;
  }

  return next();
};

export default validate;
