# Rich text (descriptions, comments, project updates)

## What is accepted

Rich-text fields accept **Markdown or HTML**. The server stores sanitized HTML.

- Send **real newlines**. The two characters `\` `n` are stored verbatim and
  render as literal text. Use `--description-file` or `-` (stdin) for anything
  multi-line — that is the reliable way.
- **GFM Markdown tables** and HTML `<table>` render as real tables, including
  `colspan` / `rowspan` and column widths.
- Task lists, mentions, headings, lists, quotes, code blocks and links all
  round-trip.

## What is stripped

Both paths are sanitized on write: `<script>`, `on*` handlers and `javascript:`
URLs are removed. Raw `<iframe>` is stripped. **External media does not embed** —
only files uploaded through `bk <app> upload` render inline (see `bk guide platform/files`).
`style` is limited to `width`, `min-width`, `height` and `text-align`.

## Markdown vs HTML detection

A body is treated as HTML only when it contains a **block-level** tag (`<p>`,
`<div>`, `<h1>`–`<h6>`, `<ul>`/`<ol>`/`<li>`, `<blockquote>`, `<pre>`, `<table>`
and friends).

This matters for a common agent case: Markdown containing an angle-bracket
placeholder — `` `<clinicId>` ``, `<uid>`, `Promise<void>` — is still parsed as
**Markdown**, and the placeholder survives as visible text whether or not it sits
in a code span. Inline tags (`<b>`, `<br>`, `<img>`) pass through inside Markdown
rather than switching the whole body to HTML.

## Example

```bash
cat > /tmp/body.md <<'EOF'
## Findings

| Area | Status |
|---|---|
| Login | fixed |

- [x] reproduced
- [ ] regression test
EOF

bk issues issue comment 42 --body-file /tmp/body.md
```

Related commands: `bk issues issue create|edit|comment`, `bk issues task create|edit|comment`, `bk issues project create|edit|comment`, `bk issues project updates add`
