/**
 * Stable error codes tools and the runtime use (blueprint §25). Kept as a const
 * map so both producers and tests reference the same identifiers.
 */
export const ErrorCode = {
  ValidationError: 'validation_error',
  PermissionDenied: 'permission_denied',
  ApprovalDenied: 'approval_denied',
  PathOutsideWorkspace: 'path_outside_workspace',
  StaleFile: 'stale_file',
  FileNotFound: 'file_not_found',
  NotAFile: 'not_a_file',
  MatchNotFound: 'match_not_found',
  MatchNotUnique: 'match_not_unique',
  CommandTimeout: 'command_timeout',
  CommandFailed: 'command_failed',
  OutputLimit: 'output_limit',
  UnknownTool: 'unknown_tool',
  Cancelled: 'cancelled',
  NetworkError: 'network_error',
  MissingCredential: 'missing_credential',
  InternalError: 'internal_error',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** A tool-layer error carrying a stable code and retryable flag (blueprint §25). */
export class ToolExecutionError extends Error {
  readonly code: ErrorCodeValue;
  readonly retryable: boolean;

  constructor(code: ErrorCodeValue, message: string, retryable = false) {
    super(message);
    this.name = 'ToolExecutionError';
    this.code = code;
    this.retryable = retryable;
  }
}

/** Thrown by the registry when a proposed tool name is unknown (blueprint §12). */
export class UnknownToolError extends ToolExecutionError {
  constructor(name: string) {
    super(ErrorCode.UnknownTool, `Unknown tool: ${name}`);
    this.name = 'UnknownToolError';
  }
}
