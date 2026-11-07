/** Typed errors that route handlers translate into JSON responses. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = (message = "Sign in to continue.") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "You do not have permission to do that.") => new AppError(403, "forbidden", message);
export const notFound = (message = "Not found.") => new AppError(404, "not_found", message);
export const badRequest = (message: string, details?: unknown) => new AppError(400, "bad_request", message, details);
export const tooManyRequests = (retryAfterSeconds: number) =>
  new AppError(429, "rate_limited", `Too many attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`, {
    retryAfterSeconds,
  });

/** Optimistic-concurrency conflict: someone else saved first. `details` carries the current server copy. */
export class ConflictError extends AppError {
  constructor(details: unknown, message = "This item was changed by someone else since you opened it.") {
    super(409, "conflict", message, details);
    this.name = "ConflictError";
  }
}
