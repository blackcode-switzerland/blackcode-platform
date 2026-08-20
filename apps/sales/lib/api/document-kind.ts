// Mapping a DERIVED media kind onto `document_kinds`, the author's vocabulary.
//
// Extracted from the create route on 2026-08-17 so `doc recheck` can use the
// same mapping. Two copies of "what do we call a video" is exactly the drift
// this repo keeps finding, and the second caller is what made it a shared
// function rather than a local one.

/**
 * A `kind` for a file whose author did not name one.
 *
 * `document_kinds` is shaped differently from the derived media kind: `deck` is
 * a judgement about purpose and `link` is one about location, and no recogniser
 * can infer either. So this maps only the four that are genuinely the same
 * question and falls back to `link` for everything else — recording "we could
 * not tell" as the neutral value rather than as a guess the author would then
 * have to notice and correct.
 *
 * An explicit `--kind` always wins. This only ever fills a blank: the create
 * path uses it when none was given, and `doc recheck` only applies it to a
 * document still carrying `link`.
 */
export function defaultKindFor(mediaKind: string): string {
  switch (mediaKind) {
    case 'image':
      return 'image'
    case 'video':
      return 'video'
    case 'pdf':
      return 'pdf'
    case 'slides':
      return 'deck'
    default:
      return 'link'
  }
}
