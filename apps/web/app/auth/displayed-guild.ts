import { DomainError } from "../../../../packages/shared/src/index";

/** Consistency check only. Call after current identity, guild access and admission checks. */
export function assertDisplayedGuild(
  expected: string | null,
  authorizedGuild: string,
) {
  if (!expected || expected !== authorizedGuild)
    throw new DomainError("SERVER_SELECTION_CHANGED", 409);
}
