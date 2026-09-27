import { ZodError } from 'zod';
import { isProd } from '../env.js';

export class ApiError extends Error {
  constructor(status, message, code = undefined, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (m, details) => new ApiError(400, m, 'BAD_REQUEST', details);
export const unauthorized = (m = 'Please sign in') => new ApiError(401, m, 'UNAUTHORIZED');
export const forbidden = (m = 'Not allowed') => new ApiError(403, m, 'FORBIDDEN');
export const notFound = (m = 'Not found') => new ApiError(404, m, 'NOT_FOUND');
export const conflict = (m, code = 'CONFLICT') => new ApiError(409, m, code);

/** Wrap an async route so a rejected promise reaches the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Parse with a zod schema, turning a failure into a 400 with field detail. */
export function parse(schema, data) {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({
        field: i.path.join('.') || '(root)',
        message: i.message,
      }));
      throw badRequest('Some details need fixing', details);
    }
    throw err;
  }
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}`, code: 'NOT_FOUND' } });
}

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
export function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl, err);
  }

  const body = {
    error: {
      message: status >= 500 && isProd ? 'Something went wrong on our end' : err.message,
      code: err.code || (status >= 500 ? 'INTERNAL' : 'ERROR'),
    },
  };
  if (err.details) body.error.details = err.details;
  if (!isProd && status >= 500) body.error.stack = err.stack;

  res.status(status).json(body);
}
