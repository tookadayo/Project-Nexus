export class ProductionError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'ProductionError'; }
}
export function safeCode(error: unknown): string {
  return error instanceof ProductionError && /^[A-Z0-9_]{1,80}$/.test(error.code)
    ? error.code : 'UNEXPECTED_FAILURE';
}