// Rendering the statutory invoice number from a company's format string.
//
// `BC-{YYYY}-{SEQ4}` → `BC-2026-0007`. Two tokens, both optional, and an
// UNKNOWN token is an error rather than a passthrough.
//
// ===========================================================================
// WHY AN UNKNOWN TOKEN THROWS
// ===========================================================================
// The alternative is leaving it in the output, which produces an invoice
// numbered `BC-{MM}-0007` — a number that looks deliberate, is printed on a
// legal document, is embedded in the payment reference, and cannot be changed
// afterwards because G1 freezes it.
//
// Refusing at render time means the company's format is rejected when somebody
// sets it, in a form they are looking at, instead of producing one permanently
// wrong number per invoice until a human notices.
//
// ── THE YEAR IS DISPLAY ONLY (position P4) ─────────────────────────────────
// `{YYYY}` is the ISSUE year, and the sequence does NOT reset when it changes:
// `seq_no` counts forever. That is the mockup's behaviour and it is recorded as
// a provisional answer — a per-year reset is one column plus a decision about
// which year it takes effect, and it is cheap to add later. What is NOT cheap is
// discovering that two invoices share a number because the reset landed
// mid-year.

/** Every token this renderer knows. Used by the error message and by the test. */
const TOKENS = ['{YYYY}', '{SEQ4}'] as const

/**
 * `renderNumber('BC-{YYYY}-{SEQ4}', 2026, 7)` → `'BC-2026-0007'`.
 *
 * `seqNo` is the per-company statutory sequence value, not the workspace
 * #number. Getting those two the wrong way round would put the address on the
 * document and the document's number in the URL.
 */
export function renderNumber(format: string, issueYear: number, seqNo: number): string {
  const unknown = format.match(/\{[^}]*\}/g)?.filter((t) => !TOKENS.includes(t as never)) ?? []
  if (unknown.length > 0) {
    throw new Error(
      `unknown token(s) ${unknown.join(', ')} in number format ${JSON.stringify(format)}. ` +
        `Known tokens: ${TOKENS.join(', ')}. Refused rather than passed through, because the ` +
        'result would be a permanent number on a legal document.'
    )
  }
  const out = format
    .replace('{YYYY}', String(issueYear))
    // Four digits, and it does NOT truncate above 9999: an invoice number that
    // silently wrapped from 9999 to 0000 would collide with one from ten
    // thousand bills ago, and `UNIQUE(company_id, seq_no)` would then be the
    // only thing standing between two documents with one number. Wider is
    // correct; a company issuing its 10000th bill gets `BC-2026-10000`.
    .replace('{SEQ4}', String(seqNo).padStart(4, '0'))

  if (out.trim().length === 0) {
    throw new Error(
      `number format ${JSON.stringify(format)} renders empty. An invoice must carry a number.`
    )
  }
  return out
}

/**
 * Validate a format string without rendering one — for the write door, so a bad
 * format is refused when somebody sets it rather than when the next invoice is
 * created.
 *
 * Returns the reason, or null when it is fine.
 */
export function checkNumberFormat(format: string): string | null {
  try {
    const sample = renderNumber(format, 2026, 1)
    if (!format.includes('{SEQ4}')) {
      // Without the sequence token every invoice from this company gets the SAME
      // number, and `UNIQUE(company_id, seq_no)` would not catch it because
      // `seq_no` still differs. The document would be the thing that collided.
      return 'the format must contain {SEQ4}, or every invoice would carry the same number'
    }
    if (sample.length > 40) {
      return 'the rendered number must fit billing.company.number_format’s 40-character column'
    }
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
