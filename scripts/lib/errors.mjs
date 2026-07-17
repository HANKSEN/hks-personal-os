export class PosError extends Error {
  constructor(code, message, details = undefined, exitCode = 2) {
    super(message);
    this.name = "PosError";
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

export function invariant(condition, code, message, details, exitCode) {
  if (!condition) {
    throw new PosError(code, message, details, exitCode);
  }
}

export function errorPayload(error) {
  if (error instanceof PosError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error),
      details: null,
    },
  };
}
