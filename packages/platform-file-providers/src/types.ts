// Where a file's bytes live, and how a web surface should show it.
//
// ---------------------------------------------------------------------------
// THE ONE DISTINCTION THIS PACKAGE EXISTS TO MAKE
// ---------------------------------------------------------------------------
// A file attached to a record is either **ours** — uploaded through
// `bk <app> upload`, stored in Vercel Blob, covered by the cross-app delete gate
// — or it lives **somewhere else** and we merely point at it.
//
// That difference is not cosmetic and it is not only about rendering:
//
//   ours       we hold the bytes. `platform.blob_references` counts every
//              reference, and nothing may delete the file while a reference
//              stands. Deleting it is our responsibility and our risk.
//   elsewhere  we hold nothing. **We must never delete it**, we cannot grant
//              access to it, and whether a given viewer can see it is decided
//              by a system we do not run.
//
// A surface that renders both identically — which is what every listing did
// before this package — hides the second row of that table from the person
// looking at it. Hence `internal`, and hence the badge every listing now shows.
//
// ---------------------------------------------------------------------------
// PURE, AND IT HAS TO STAY PURE
// ---------------------------------------------------------------------------
// No database, no network, no node built-ins, no dependencies. Two reasons, and
// the first one is a hard constraint rather than a preference:
//
//  1. **A `"use client"` React tree imports this.** Rendering a preview is a
//     browser concern. `@blackcode/platform-storage` — the obvious other home
//     for this code — pulls in the drizzle `Executor` and the module that can
//     reach Vercel Blob's `del()`. That must never be reachable from a bundle
//     shipped to a browser.
//  2. A pure function of a URL is testable without a fixture, which is what
//     makes it cheap to add the next provider.
//
// The one thing that genuinely needs the network — "can a viewer actually open
// this Drive link?" — is deliberately NOT here. It is a probe the server runs
// and a result the app stores; see the sales `documents.preview_status` column.

/**
 * Which system holds the bytes.
 *
 * `blob` is ours. Everything else is somebody else's. Open rather than a closed
 * union (`string & {}` keeps editor completion while permitting a value this
 * build has not heard of) because the value is STORED: a row written by a newer
 * deployment must not fail to type-check in an older one, and an app reading
 * `dropbox` before this package knows the word should degrade to a plain link
 * rather than crash.
 */
export type StorageProviderId = 'blob' | 'google_drive' | (string & {})

/**
 * What the file IS, for choosing a renderer — not what the author called it.
 *
 * Deliberately distinct from `documents.kind` in the sales app, which is the
 * author's own label (`pdf`, `deck`, `image`, `video`, `link`) and stays under
 * their control. This is derived, and derived values are recomputed on read so
 * that improving the detection improves every existing row with no migration.
 *
 * `doc`/`sheet`/`slides` are separate rather than one `document`: they are three
 * different Google embed endpoints and three different icons, and collapsing
 * them would mean re-deriving the difference at every call site.
 */
export type MediaKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'folder'
  | 'archive'
  | 'other'

/**
 * How a web surface should embed this file.
 *
 * `none` is a real answer and the most important one: a folder, an unrecognised
 * host, or a Drive file nobody has shared cannot be embedded, and the caller
 * must render a card with a link instead of an `<iframe>` that shows a Google
 * sign-in page inside our page.
 */
export type EmbedMode = 'image' | 'video' | 'audio' | 'iframe' | 'none'

export interface FileEmbed {
  mode: EmbedMode
  /** The url to put in the `src`. Null when `mode` is `none`. */
  url: string | null
}

/** Everything a surface needs to show one file, derived from its url. */
export interface FileDescriptor {
  provider: StorageProviderId
  /**
   * True when WE hold the bytes.
   *
   * The delete gate applies to exactly these, and the UI badge says so. It is a
   * separate field from `provider === 'blob'` on purpose: a future
   * self-hosted-S3 provider would also be internal, and every call site that had
   * compared against the string would then be quietly wrong.
   */
  internal: boolean
  /** The provider's own handle — a Drive file id. Null for our own uploads. */
  external_id: string | null
  media_kind: MediaKind
  embed: FileEmbed
  /** A still image, when one can be had without credentials. */
  thumbnail_url: string | null
  /** Where "open the original" goes. Always present — even `none` embeds. */
  open_url: string
  /** For the badge. "Blackcode storage", "Google Drive". */
  label: string
}

/** Optional facts the caller already knows that a url cannot carry. */
export interface DescribeHints {
  /** From `platform.uploads` / the upload response. Beats extension sniffing. */
  mime?: string | null
  /** When the url's own path is opaque — a signed url, a short link. */
  filename?: string | null
}

/**
 * One system that can hold a file.
 *
 * **Adding a provider is this interface and one line in the registry.** That is
 * the whole extensibility story and it is deliberately small: `match` gets a
 * parsed URL and returns null if it is not ours, so a provider cannot
 * accidentally claim another's urls by being registered first — it has to
 * recognise them.
 */
export interface FileProvider {
  id: StorageProviderId
  label: string
  internal: boolean
  /**
   * Recognise a url. Return null to decline.
   *
   * MUST be side-effect free and MUST NOT throw: `describeFile` runs it over
   * every registered provider, and one that throws on an odd url would take
   * down the listing that rendered it.
   */
  match(url: URL, hints: DescribeHints): Omit<FileDescriptor, 'provider' | 'internal' | 'label'> | null
}
