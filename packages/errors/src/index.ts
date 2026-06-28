/** Typed application errors. Isomorphic (safe in browser and node). */

export interface AppErrorOptions {
  code: string;
  httpStatus: number;
  publicMessage: string;
  isOperational?: boolean;
  cause?: unknown;
  /** Internal context for logs/audit only — NEVER serialized to clients. */
  meta?: Record<string, unknown>;
  /**
   * Client-safe structured detail (e.g. zod validation issues). Unlike `meta`
   * this IS serialized to clients, so it must never contain secrets/PII/values.
   */
  publicDetails?: unknown;
}

export interface PublicErrorBody {
  error: { code: string; message: string; correlationId: string; details?: unknown };
}

export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly publicMessage: string;
  readonly isOperational: boolean;
  readonly meta?: Record<string, unknown>;
  readonly publicDetails?: unknown;

  constructor(options: AppErrorOptions) {
    super(options.publicMessage, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.publicMessage = options.publicMessage;
    this.isOperational = options.isOperational ?? true;
    this.meta = options.meta;
    this.publicDetails = options.publicDetails;
  }

  /** Client-safe projection: no stack, no cause, no meta (ERR-2/ERR-3). */
  toPublic(correlationId: string): PublicErrorBody {
    const error: PublicErrorBody['error'] = {
      code: this.code,
      message: this.publicMessage,
      correlationId,
    };
    if (this.publicDetails !== undefined) error.details = this.publicDetails;
    return { error };
  }
}

export class ValidationError extends AppError {
  constructor(
    publicMessage = 'Validation failed',
    meta?: Record<string, unknown>,
    publicDetails?: unknown,
  ) {
    super({ code: 'VALIDATION_FAILED', httpStatus: 400, publicMessage, meta, publicDetails });
  }
}

export class AuthnError extends AppError {
  constructor(publicMessage = 'Authentication required', meta?: Record<string, unknown>) {
    super({ code: 'AUTHN_REQUIRED', httpStatus: 401, publicMessage, meta });
  }
}

export class AuthzError extends AppError {
  constructor(publicMessage = 'Access denied', meta?: Record<string, unknown>) {
    super({ code: 'AUTHZ_DENIED', httpStatus: 403, publicMessage, meta });
  }
}

export class NotFoundError extends AppError {
  constructor(publicMessage = 'Not found', meta?: Record<string, unknown>) {
    super({ code: 'NOT_FOUND', httpStatus: 404, publicMessage, meta });
  }
}

export class ToolApprovalRequiredError extends AppError {
  constructor(publicMessage = 'Approval required', meta?: Record<string, unknown>) {
    super({ code: 'TOOL_APPROVAL_REQUIRED', httpStatus: 409, publicMessage, meta });
  }
}

export class ConflictError extends AppError {
  constructor(publicMessage = 'Conflict', meta?: Record<string, unknown>) {
    super({ code: 'CONFLICT', httpStatus: 409, publicMessage, meta });
  }
}

export class NotImplementedError extends AppError {
  constructor(publicMessage = 'Not implemented', meta?: Record<string, unknown>) {
    super({ code: 'NOT_IMPLEMENTED', httpStatus: 501, publicMessage, meta });
  }
}

export class UpstreamError extends AppError {
  constructor(publicMessage = 'Upstream service error', meta?: Record<string, unknown>) {
    super({ code: 'UPSTREAM_ERROR', httpStatus: 502, publicMessage, meta });
  }
}
