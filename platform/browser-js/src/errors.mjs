export class Browser_Error extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'Browser_Error';
    this.code = code;
    this.details = details;
  }
}

export function require_condition(condition, code, message, details = {}) {
  if (!condition) {
    throw new Browser_Error(code, message, details);
  }
}
