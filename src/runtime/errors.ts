import { ErrorCode, type ErrorCodeValue } from '../tools/core/index.ts';

/** Base runtime error carrying a stable code (blueprint §25). */
export class RuntimeError extends Error {
  readonly code: ErrorCodeValue;

  constructor(code: ErrorCodeValue, message: string) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
  }
}

export class MaxStepsExceededError extends RuntimeError {
  constructor(maxSteps: number) {
    super(ErrorCode.InternalError, `Turn exceeded max steps (${maxSteps})`);
    this.name = 'MaxStepsExceededError';
  }
}

export class TurnCancelledError extends RuntimeError {
  constructor() {
    super(ErrorCode.Cancelled, 'Turn cancelled');
    this.name = 'TurnCancelledError';
  }
}

export { ErrorCode };
export type { ErrorCodeValue };
