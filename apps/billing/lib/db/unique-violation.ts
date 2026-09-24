// Recognise ONE named unique violation, anywhere on the cause chain.
//
// Drizzle wraps the driver's error and its own message is "Failed query: …", so
// a check on the top-level object alone never sees the sqlstate or the
// constraint (`packages/platform-api/src/handler.ts`'s `pgViolation` walks the
// chain for the same reason). This is the narrow form: the caller names the
// constraint it expects, so a different unique index — the gapless number, the
// idempotency key — is never dressed up as the refusal it did not cause.
//
// Lived privately in `queries/recurrences.ts` until 2026-09-23; invoices and
// companies needed it too (ticket #757), and three private copies of a chain
// walk is how one of them ends up checking the top level only.

export function isUniqueViolation(err: unknown, constraint: string): boolean {
  for (
    let x = err as { code?: unknown; constraint?: unknown; cause?: unknown } | null | undefined;
    x;
    x = x.cause as typeof x
  ) {
    if (x.code === '23505' && x.constraint === constraint) return true
  }
  return false
}
