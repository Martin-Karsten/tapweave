export class Browser_Error extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'Browser_Error';
    this.code = code;
    this.details = details;
  }
}

export function require_condition(condition: unknown, code: string, message: string,
  details: Record<string, unknown> = {}): asserts condition {
  if (!condition) {
    throw new Browser_Error(code, message, details);
  }
}

export function all_finite(values: readonly unknown[]) {
  return values.every(value => typeof value === 'number' && Number.isFinite(value));
}
