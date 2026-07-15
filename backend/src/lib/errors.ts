/**
 * Application errors that map cleanly to HTTP responses.
 * Thrown from services; translated to JSON by the global error handler.
 */
export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const BadRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const Unauthorized = (message = 'Unauthorized') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const Forbidden = (message = 'Forbidden') => new AppError(403, 'FORBIDDEN', message);

export const NotFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);

export const Conflict = (message: string) => new AppError(409, 'CONFLICT', message);

export const UpstreamError = (message: string, details?: unknown) =>
  new AppError(502, 'UPSTREAM_ERROR', message, details);
