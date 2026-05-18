/**
 * Domain errors that the HTTP server unwraps into typed `{code, message}`
 * envelopes. Plain `Error` still works (mapped to INTERNAL); use these only
 * when callers need to branch on the failure mode.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
