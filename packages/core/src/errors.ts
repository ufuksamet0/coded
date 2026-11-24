export class CodedError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'config'
      | 'provider'
      | 'auth'
      | 'rate_limit'
      | 'network'
      | 'tool'
      | 'permission'
      | 'aborted'
      | 'unknown' = 'unknown',
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CodedError';
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof CodedError) return error.code === 'aborted';
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.message.includes('aborted');
  }
  return false;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
