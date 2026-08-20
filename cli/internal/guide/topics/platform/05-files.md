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

Only urls from **our** upload pipeline are upgraded inside RICH TEXT. An
external url in a body stays a plain link — so "embed this video in a
description" still means "upload it first".

**A document in an app's LIBRARY is different**, and that is what the next
section is about: a library entry may live in Google Drive and still be
previewed.

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

## Two places a file can live

Every app that keeps a document library gives you two ways to attach one, and
the choice is a real one:

| | our storage | an external provider |
|---|---|---|
| how | `bk <app> upload <file>` then `doc add --upload <url>` | `doc add --url <url>` |
| who holds the bytes | we do | they do |
| deletion | protected while anything references it | **never ours to delete** |
| who can see it | anyone who can see the record | whoever the provider says |
| preview | always | only if the provider will show it to an anonymous viewer |

Run `bk meta` for the providers a given app recognises — it is served live, so a
provider added on the server is visible before your binary knows about it. Today
that is our own storage, Google Drive, and a catch-all for any other link.

**Which to use.** Upload things the app produced or that must always render: a
screenshot, an export, an image for a description. Link the company's real
documents — decks, contracts, recordings, spreadsheets — because they already
live where sharing and permissions are managed, and a second copy in our storage
goes stale the moment somebody edits the original.

## Google Drive

A Drive link is recognised automatically. File, Doc, Sheet, Slides and folder
urls all work, in any of the shapes Drive emits:

```bash
bk sales doc add --title "AP configurator walkthrough" \
  --url "https://drive.google.com/file/d/<id>/view" \
  --prospect 12 --product 3
```

`--kind` is optional. For a Drive link the type is not in the url — a video, a
pdf and a sheet all look the same — so the server asks the provider for it with
a one-byte request. The command prints what it worked out and, more importantly,
**whether the file can actually be shown**:

```
added document #14: AP configurator walkthrough
  source: Google Drive · video · kind=video
  preview: anyone with the link can view it — it will render in the app
```

### The one thing you must do yourself

**We hold no Google credentials and cannot grant access to anything.** If a
Drive file is private, the app cannot preview it — it renders a card with an
"Open" button instead, and the person looking at it needs their own Drive access.

So: share the file **"anyone with the link"** in Drive, then confirm it:

```bash
bk sales doc recheck 14        # re-asks the provider
bk sales doc recheck all       # the whole library
```

`doc add` and `doc list` both tell you when something is unviewable, so you find
out in the command that created it rather than from somebody in a meeting. A
`!` in the SOURCE column means exactly this.

Uploading a file **to** Drive is not something these apps do — use your own
Drive tooling, then attach the link.

### Attaching one thing to several places

A document lives in ONE library and is linked to many things; linking it to a
second prospect does not copy it.

```bash
bk sales doc link 14 --prospect 12
bk sales doc link 14 --product 3
bk sales doc link 14 --strategy 1
bk sales doc link 14 --template 3
```

`doc add` takes the same flags, repeatably, to do it in one call. `doc show`
lists all four, and `doc list --prospect|--product|--template` filters by any of
them — the same one library seen from different sides, never copies.

### What a preview looks like

Previews are a WEB affordance; there is nothing to render in a terminal. On the
web, clicking Preview opens the file **full screen** over the page, with the
provider named and a link to the original.

Two limits worth knowing, both measured rather than assumed:

- **A Drive thumbnail may not render on an insecure origin.** Browsers refuse
  Google's image for a page served over plain `http://` — local development —
  while a normal `https://` deployment shows it. The row falls back to a type
  icon when that happens, so nothing looks broken either way.
- **The preview is the provider's own viewer**, so it renders for a viewer who
  can already open the file. That is why `doc add` tells you the sharing status
  up front.
