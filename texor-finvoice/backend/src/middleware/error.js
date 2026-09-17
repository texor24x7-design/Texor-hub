import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import env from '../config/env.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`No route matches ${req.method} ${req.originalUrl}`));
}

/**
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so controllers can throw freely without a wrapper.
 */
export function errorHandler(error, _req, res, _next) {
  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
  }

  // A schema parsed inside a service rather than by `validate` still means bad input.
  if (error?.name === 'ZodError') {
    return res.status(400).json({
      error: {
        code: 'bad_request',
        message: 'Some fields need attention.',
        details: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
      },
    });
  }

  // A body over the upload limit.
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'too_large', message: 'That file is too large.' } });
  }

  // Mongo duplicate key — surfaces as a conflict rather than a 500.
  if (error?.code === 11000) {
    return res.status(409).json({
      error: { code: 'conflict', message: 'That value is already taken.', details: error.keyValue },
    });
  }

  logger.error('unhandled error', error);

  return res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our end.',
      ...(env.isProduction ? {} : { debug: error?.message, stack: error?.stack }),
    },
  });
}
