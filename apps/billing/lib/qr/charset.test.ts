// §4.1.1, at its edges.
//
// Watched failing on 2026-09-17: Latin-1's lower bound moved from 0xA0 to 0x80
// → the C1 control character case went red. Restored.
import { describe, expect, it } from 'vitest'
import { charLength, findDisallowed, isAllowedCodepoint } from './charset'

describe('the Swiss QR Code character set', () => {
  it('allows the names the examples use, and the five extra characters', () => {
    expect(findDisallowed('Max Muster & Söhne (sample company)')).toBeNull()
    expect(findDisallowed('Ș ș Ț ț €')).toBeNull()
    expect(findDisallowed('Łódź')).toBeNull() // Latin Extended-A, U+0141 and U+017A
  })

  it('draws every range boundary exactly', () => {
    const cases: Array<[number, boolean]> = [
      [0x1f, false], [0x20, true], [0x7e, true], [0x7f, false],
      [0x9f, false], [0xa0, true], [0xff, true], [0x100, true],
      [0x17f, true], [0x180, false], [0x217, false], [0x218, true],
      [0x21b, true], [0x21c, false], [0x20ac, true], [0x20ad, false],
    ]
    for (const [cp, allowed] of cases) {
      expect(isAllowedCodepoint(cp), `U+${cp.toString(16)}`).toBe(allowed)
    }
  })

  it('refuses a line break — the character that would shift every payload line after it', () => {
    expect(findDisallowed('Merci\npour votre commande')).toEqual({ character: '\n', codepoint: 'U+000A', position: 6 })
  })

  it('counts positions and lengths in characters, not UTF-16 units', () => {
    expect(findDisallowed('ab😀c')).toEqual({ character: '😀', codepoint: 'U+1F600', position: 3 })
    expect(findDisallowed('ab😀c😀')?.position).toBe(3)
    expect(charLength('Söhne😀')).toBe(6)
    expect('Söhne😀'.length).toBe(7)
  })

  it('refuses characters outside every range, such as schwa', () => {
    expect(findDisallowed('Səhne')?.codepoint).toBe('U+0259')
  })
})
