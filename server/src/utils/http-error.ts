export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new HttpError(400, message, 'bad_request', details);
  }

  static unauthorized(message = 'Authentication required') {
    return new HttpError(401, message, 'unauthorized');
  }

  static forbidden(message = 'You do not have access to this resource') {
    return new HttpError(403, message, 'forbidden');
  }

  static notFound(message = 'Not found') {
    return new HttpError(404, message, 'not_found');
  }

  static conflict(message: string) {
    return new HttpError(409, message, 'conflict');
  }

  static unavailable(message: string) {
    return new HttpError(503, message, 'unavailable');
  }
}
