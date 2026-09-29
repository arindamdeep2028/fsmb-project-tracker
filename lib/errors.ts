export type ActionResult<T = unknown> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; message: string };

type DbError = { code?: string; message?: string } | null | undefined;

/**
 * v2 §14.9: a refused write (permission) gets one generic message; a broken business rule shows the
 * rule's own sentence, which the database writes in plain language.
 */
export function describeError(error: DbError): string {
  if (!error) return "Something went wrong. Try again.";
  switch (error.code) {
    case "42501":
      return "You don't have permission to do that.";
    case "23503":
      return "This item has daily-report history, so it can't be deleted. Archive it instead.";
    case "23505":
      return "That already exists. Check the code, name or date and try again.";
    case "23514":
    case "22023":
    case "P0001":
      return cleanMessage(error.message);
    case "PGRST116":
      return "Not found, or you no longer have access to it.";
    default:
      return cleanMessage(error.message) || "Something went wrong. Try again.";
  }
}

function cleanMessage(m?: string): string {
  if (!m) return "That change breaks a project rule.";
  // Check-constraint violations name the constraint rather than the rule.
  if (m.startsWith("new row for relation") || m.includes("violates check constraint")) return "One of the values is out of range.";
  return m;
}

export function fail(error: DbError): { ok: false; message: string } {
  return { ok: false, message: describeError(error) };
}
