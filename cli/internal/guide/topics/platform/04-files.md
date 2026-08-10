# Files, images & embedding

## What is accepted

**Any file type except the ones listed in `media.blocked_mime_types` in
`bk meta`** (currently SVG, blocked because it can carry script). Do not assume
"any type" — check `bk meta`; the block list can change without a CLI release.

Maximum size: `limits.upload_max_bytes` in `bk meta`. Uploading a larger file
fails before any bytes are sent.

## How an uploaded file renders

Once an uploaded url is referenced in a rich-text body, the server upgrades it
automatically. The rule set is served live as `media` in `bk meta`:

| MIME | Renders as |
|---|---|
| `image/*` | inline image preview |
| `video/*` | inline `<video>` player |
| `audio/*` | inline `<audio>` player |
| `application/pdf` | card with **View** + **Download** |
| everything else | download card |

Only urls from **our** upload pipeline are upgraded. An external url stays a
plain link — so "embed this video" always means "upload it first".

## The three ways to embed

**1. One step (easiest).** The `--file` flag uploads and embeds in one call:

```bash
bk issues issue create --title "Crash report" --file ./screenshot.png
bk issues issue comment 42 --file ./trace.log
bk issues project create --name "Launch" --file ./deck.pdf
```

**2. Reference a local path inside the body.** The CLI finds local paths in your
Markdown, uploads them, and rewrites the reference:

```bash
bk issues issue edit 42 --description '![](./screenshot.png)'
```

**3. Upload first, embed by url.**

```bash
url=$(bk issues upload ./clip.mp4 --json | jq -r '.url')
bk issues issue comment 42 --body "[clip.mp4]($url)"
```

`upload` is **app-owned**: it is spelled `bk <app> upload`, there is no bare
form, and the app segment decides which app the file is filed under. Uploading
through the wrong app records the file as that app's — nothing downstream can
tell it was a mistake. See `bk guide platform/apps`.

Write `![name](url)` for an image and `[name](url)` for anything else. The server
promotes a non-image written with image syntax to the right player anyway.

## Paths with spaces or parentheses

Wrap the target in **angle brackets** or Markdown stops the link at the first
`)`:

```
[](</abs/my file (2).mp4>)
```

## Attachments are a different thing

`bk issues issue attach <id> --file ./x` adds to the issue's **attachments list** (the
sidebar). It does not put the file in the body. Use `--file` on
`create`/`edit`/`comment` for in-body embedding.

```bash
bk issues issue attach 42 --file ./log.txt
bk issues issue attachments 42
bk issues issue detach 42 <attachment-id>
```

Related commands: `bk issues upload`, `bk issues storage list`, `bk issues issue attach|detach|attachments`, `bk issues attachment list`, `bk issues issue|task|project create --file`, `bk meta`, `bk guide platform/apps`
