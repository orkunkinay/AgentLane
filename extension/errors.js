// Public failure metadata contains no page/input content or browser target identifiers.
export class CoordinationError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.details = {
      code,
      message,
      mayHaveExecuted: options.mayHaveExecuted ?? false,
      retrySafe: options.retrySafe ?? false,
      humanActionRequired: options.humanActionRequired ?? false,
      recovery: options.recovery ?? 'Observe current state before deciding the next operation.',
      ...(options.operationId ? { operationId: options.operationId } : {}),
    };
  }
}
export function describeFailure(error, options = {}) {
  if (error.details) return error.details;
  const message = error.message || 'Browser operation failed';
  const code = /Session disconnected|cancelled/i.test(message)
    ? 'OPERATION_CANCELLED'
    : /focused|minimized|picker was blocked/i.test(message)
      ? 'FOCUS_ISOLATION_UNSUPPORTED'
      : /moved outside|ownership revoked/i.test(message)
        ? 'TARGET_OWNERSHIP_CONFLICT'
        : /No owned tab|recreated|Prepare a lane|window is closed/i.test(message)
          ? 'SESSION_RECOVERY_REQUIRED'
          : /not approved|not allowed|Unsupported operation/i.test(message)
            ? 'CAPABILITY_DENIED'
            : /Stale or missing frame/i.test(message)
              ? 'OBSERVATION_REQUIRED'
              : /timed out/i.test(message)
                ? 'OPERATION_OUTCOME_UNKNOWN'
                : 'OPERATION_FAILED';
  return new CoordinationError(code, message, {
    ...options,
    humanActionRequired: code === 'FOCUS_ISOLATION_UNSUPPORTED',
  }).details;
}
