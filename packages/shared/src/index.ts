import { z } from 'zod';
export const scopeSchema = z.object({organizationId:z.uuid(),guildId:z.string().regex(/^\d{17,20}$/)}).strict();
export type Scope = z.infer<typeof scopeSchema>;
export const contextSchema = z.enum(['PRODUCTION','TEST','PREVIEW']);
export type EventContext = z.infer<typeof contextSchema>;
export class DomainError extends Error {
  constructor(public readonly code:string, public readonly status=400) { super(code); }
}
export function assert(condition:unknown, code:string, status=400):asserts condition {
  if (!condition) throw new DomainError(code,status);
}
