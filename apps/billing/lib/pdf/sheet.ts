// A page, in millimetres, measured from its TOP-LEFT corner.
//
// ===========================================================================
// WHY THIS LAYER EXISTS
// ===========================================================================
// The QR-bill standard and its Style Guide state every position in millimetres
// from the top of the payment part. pdf-lib works in points from the BOTTOM-left
// corner. Doing that conversion at every call site is how a 3 mm drift ships: one
// coordinate forgets to subtract from the page height, and the result still
// looks nearly right.
//
// So every drawing call in `lib/pdf/` goes through `Sheet`, which converts once.
// It also records what it drew (`sheet.log`) so tests can assert on the WORDS a
// page carries — pdf-lib writes custom-font text as glyph ids, which a byte search
// of the saved file cannot read — and it wraps regions in PDF marked content, so
// tests can MEASURE the saved file's geometry rather than trust the input.

import {
  PDFPage,
  PDFFont,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  beginMarkedContent,
  endMarkedContent,
  setFillingRgbColor,
  setStrokingRgbColor,
  setLineWidth,
  setDashPattern,
  rectangle,
  fill,
  moveTo,
  lineTo,
  stroke,
} from 'pdf-lib'

/** 1 mm in PDF points. The one conversion; see this file's header. */
export const PT_PER_MM = 72 / 25.4
export const mm = (millimetres: number): number => millimetres * PT_PER_MM
export const ptToMm = (points: number): number => points / PT_PER_MM

export const A4 = { width: 210, height: 297 } as const

export interface TextOptions {
  font: PDFFont
  /** Points, as the standard states font sizes. */
  size: number
  /** Right-align within this width, starting at `x`. */
  alignRightWithin?: number
}

export interface LogEntry {
  kind: 'text' | 'rect' | 'line'
  text?: string
  x: number
  y: number
  w?: number
  h?: number
  size?: number
  bold?: boolean
  tag?: string
}

export class Sheet {
  readonly log: LogEntry[] = []
  private tags: string[] = []

  constructor(
    readonly page: PDFPage,
    private readonly bold: PDFFont
  ) {}

  private yPt(topMm: number): number {
    return this.page.getHeight() - mm(topMm)
  }

  /** Wrap drawing in PDF marked content `/tag BMC … EMC`, so a test can find it in the saved file. */
  marked(tag: string, draw: () => void): void {
    this.page.pushOperators(beginMarkedContent(tag))
    this.tags.push(tag)
    try {
      draw()
    } finally {
      this.tags.pop()
      this.page.pushOperators(endMarkedContent())
    }
  }

  /** Text whose TOP (the font's ascent) sits at `yTop` mm. Returns the height it used, in mm. */
  text(value: string, x: number, yTop: number, o: TextOptions): number {
    const ascent = o.font.heightAtSize(o.size, { descender: false })
    const width = o.font.widthOfTextAtSize(value, o.size)
    const xPt = o.alignRightWithin !== undefined ? mm(x + o.alignRightWithin) - width : mm(x)
    this.page.drawText(value, { x: xPt, y: this.yPt(yTop) - ascent, size: o.size, font: o.font, color: rgb(0, 0, 0) })
    this.log.push({ kind: 'text', text: value, x, y: yTop, size: o.size, bold: o.font === this.bold, tag: this.tags.at(-1) })
    return lineHeightMm(o.size)
  }

  // ── RECTANGLES AND LINES ARE RAW OPERATORS, IN ABSOLUTE COORDINATES ──────
  // pdf-lib's `drawRectangle` writes `0 0 w h re` inside a `cm` translation, so
  // the position lives in a matrix. That is correct PDF and it is unmeasurable
  // by the tests that read the saved file (`pdf.test.ts`), which is the only
  // kind of geometry test the standard's sizes deserve. `x y w h re` and
  // `x y m … l` carry the position themselves.

  /** A filled rectangle, top-left at (x, yTop). */
  fill(x: number, yTop: number, w: number, h: number, white = false): void {
    const c = white ? 1 : 0
    this.page.pushOperators(
      pushGraphicsState(),
      setFillingRgbColor(c, c, c),
      rectangle(mm(x), this.yPt(yTop + h), mm(w), mm(h)),
      fill(),
      popGraphicsState()
    )
    this.log.push({ kind: 'rect', x, y: yTop, w, h, tag: this.tags.at(-1) })
  }

  /** A straight line between two points, in mm, `thickness` in points. */
  line(x1: number, y1: number, x2: number, y2: number, thickness: number, dashed = false): void {
    this.page.pushOperators(
      pushGraphicsState(),
      setStrokingRgbColor(0, 0, 0),
      setLineWidth(thickness),
      setDashPattern(dashed ? [2, 2] : [], 0),
      moveTo(mm(x1), this.yPt(y1)),
      lineTo(mm(x2), this.yPt(y2)),
      stroke(),
      popGraphicsState()
    )
    this.log.push({ kind: 'line', x: x1, y: y1, w: x2 - x1, h: y2 - y1, tag: this.tags.at(-1) })
  }

  /** Isolate graphics state for a block of drawing. */
  isolated(draw: () => void): void {
    this.page.pushOperators(pushGraphicsState())
    try {
      draw()
    } finally {
      this.page.pushOperators(popGraphicsState())
    }
  }
}

/** Line pitch for a font size, in mm: 1.2 × the size, the conventional leading. */
export function lineHeightMm(sizePt: number): number {
  return ptToMm(sizePt * 1.2)
}

/**
 * Break `text` into lines no wider than `widthMm`, on spaces; a single word
 * wider than the line is broken by character rather than overflowing.
 */
export function wrap(text: string, font: PDFFont, size: number, widthMm: number): string[] {
  const max = mm(widthMm)
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= max) {
        line = candidate
        continue
      }
      if (line) out.push(line)
      if (font.widthOfTextAtSize(word, size) <= max) {
        line = word
        continue
      }
      let piece = ''
      for (const ch of word) {
        if (font.widthOfTextAtSize(piece + ch, size) > max && piece) {
          out.push(piece)
          piece = ch
        } else {
          piece += ch
        }
      }
      line = piece
    }
    out.push(line)
  }
  return out
}
