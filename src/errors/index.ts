/**
 * Base application error with HTTP status code
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Docker sandbox-related errors
 */
export class SandboxError extends AppError {
  constructor(message: string) {
    super(message, 503, 'SANDBOX_ERROR');
  }
}

/**
 * Metrics collection errors
 */
export class MetricsError extends AppError {
  constructor(message: string) {
    super(message, 500, 'METRICS_ERROR');
  }
}

/**
 * File upload validation errors
 */
export class UploadError extends AppError {
  constructor(message: string) {
    super(message, 400, 'UPLOAD_ERROR');
  }
}

/**
 * Resource not found
 */
export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} with id '${id}' not found`, 404, 'NOT_FOUND');
  }
}

/**
 * Idempotency conflict — resource already exists
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

/**
 * Timeout during sandbox execution
 */
export class TimeoutError extends AppError {
  constructor(message: string) {
    super(message, 504, 'TIMEOUT');
  }
}
