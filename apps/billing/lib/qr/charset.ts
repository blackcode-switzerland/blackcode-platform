// The characters a Swiss QR Code may carry (§4.1.1), and nothing else.
//
// ===========================================================================
// REJECT. NEVER TRANSLITERATE.
// ===========================================================================
// The creditor name on a QR-bill must match the name on the credit account
// (§4.3.1). A library that quietly turns `Ł` into `L` produces a bill whose
// creditor is somebody else as far as a strict bank is concerned, and nobody
// finds out until a payment is returned. So this module only answers "is this
// allowed?", and says exactly which character is not, where.
//
// ── IT ALSO KEEPS THE PAYLOAD'S STRUCTURE INTACT ───────────────────────────
// Line breaks are not in the set. A payment message containing `\n` — typed
// into a textarea, pasted from an email — would otherwise split one payload
// line into two and shift every line after it: the reference type would be
// read as the reference, and so on. The character set refusing it is what
// stops that, so the refusal names the character by codepoint as well.

/** §4.1.1, as codepoint ranges. */
export function isAllowedCodepoint(cp: number): boolean {
  return (
    (cp >= 0x20 && cp <= 0x7e) || // Basic Latin
    (cp >= 0xa0 && cp <= 0xff) || // Latin-1 Supplement
    (cp >= 0x100 && cp <= 0x17f) || // Latin Extended-A
    cp === 0x218 || // Ș
    cp === 0x219 || // ș
    cp === 0x21a || // Ț
    cp === 0x21b || // ț
    cp === 0x20ac // €
  )
}

export interface DisallowedCharacter {
  /** The character itself. */
  character: string
  /** `U+000A`. */
  codepoint: string
  /** 1-based, in characters (code points), which is how a person counts. */
  position: number
}

/**
 * The first character outside the set, or null.
 *
 * Iterates by CODE POINT, not by UTF-16 unit: an emoji is one character to a
 * person and two units to `String.prototype.length`, and a position that
 * counted units would point past the character it names.
 */
export function findDisallowed(value: string): DisallowedCharacter | null {
  let position = 0
  for (const ch of value) {
    position++
    const cp = ch.codePointAt(0)!
    if (!isAllowedCodepoint(cp)) {
      return {
        character: ch,
        codepoint: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'),
        position,
      }
    }
  }
  return null
}

/** Length in characters, the unit every limit in Table 8 is stated in. */
export function charLength(value: string): number {
  let n = 0
  for (const _ of value) n++
  return n
}
