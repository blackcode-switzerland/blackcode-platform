// `describeFile` — the one function every surface calls.
//
// Give it a url (and whatever else you happen to know) and it says where the
// bytes live, what kind of thing it is, and how to show it. See `types.ts` for
// why the internal/external distinction is the point rather than a detail.

import { PROVIDERS, externalGeneric } from './providers'
import type { DescribeHints, FileDescriptor } from './types'

export type {
  DescribeHints,
  EmbedMode,
  FileDescriptor,
  FileEmbed,
  FileProvider,
  MediaKind,
  StorageProviderId,
} from './types'
export { mediaKindOf, extensionOf } from './media-kind'
export { PROVIDERS, registerProvider, externalGeneric, blob, googleDrive } from './providers'

/**
 * Describe a file from its url.
 *
 * ---------------------------------------------------------------------------
 * IT NEVER THROWS AND IT NEVER RETURNS NULL
 * ---------------------------------------------------------------------------
 * This runs inside listing renderers, in a browser, over data that arrived from
 * a database. A malformed url is not exceptional — somebody typed one, or a
 * column holds a value from before validation existed — and the correct
 * response to it is a card that says so, not a page that fails to render.
 *
 * So an unparseable url produces an `external` descriptor with the raw string as
 * `open_url`. The link may not work; the page does.
 *
 * A provider that throws is likewise caught and treated as a decline. A
 * `match()` is documented as side-effect free and non-throwing, and this is the
 * belt to that braces: a bug in one provider must not blank a whole listing.
 */
export function describeFile(rawUrl: string, hints: DescribeHints = {}): FileDescriptor {
  const trimmed = (rawUrl ?? '').trim()

  let url: URL | null = null
  try {
    url = new URL(trimmed)
  } catch {
    // A same-origin path (`/uploads/x.png`) is a legitimate value and is not an
    // absolute url. Parse it against a placeholder base so the providers see a
    // real URL — `blob` recognises the `/uploads/` prefix, which is the branch
    // `platform.is_uploaded_asset` checks first.
    if (trimmed.startsWith('/')) {
      try {
        url = new URL(trimmed, 'https://placeholder.invalid')
      } catch {
        url = null
      }
    }
  }

  if (url) {
    for (const provider of PROVIDERS) {
      let match
      try {
        match = provider.match(url, hints)
      } catch {
        continue
      }
      if (match) {
        return {
          ...match,
          provider: provider.id,
          internal: provider.internal,
          label: provider.label,
          // A relative url must come back OUT relative: the placeholder base
          // above is a parsing device, and letting `placeholder.invalid` reach
          // an `<img src>` would break every locally-stored file.
          open_url: trimmed.startsWith('/') ? trimmed : match.open_url,
          embed:
            trimmed.startsWith('/') && match.embed.url
              ? { ...match.embed, url: trimmed }
              : match.embed,
          thumbnail_url:
            trimmed.startsWith('/') && match.thumbnail_url ? trimmed : match.thumbnail_url,
        }
      }
    }
    const fallback = externalGeneric.match(url, hints)!
    return {
      ...fallback,
      provider: externalGeneric.id,
      internal: externalGeneric.internal,
      label: externalGeneric.label,
    }
  }

  // Unparseable. Still describable.
  return {
    provider: externalGeneric.id,
    internal: false,
    external_id: null,
    media_kind: 'other',
    embed: { mode: 'none', url: null },
    thumbnail_url: null,
    open_url: trimmed,
    label: externalGeneric.label,
  }
}

/**
 * The providers, in the shape `/api/meta` serves so an agent can discover them
 * without a CLI release.
 *
 * `example` is a URL SHAPE rather than a real link, and it is here rather than
 * in a guide topic on purpose: a guide ships inside the binary and would
 * describe the providers that existed when it was built, which is exactly the
 * drift `bk meta` exists to prevent.
 */
export function providerManifest(): Array<{
  id: string
  label: string
  internal: boolean
  example: string | null
}> {
  return [
    ...PROVIDERS.map((p) => ({
      id: String(p.id),
      label: p.label,
      internal: p.internal,
      example:
        p.id === 'blob'
          ? 'the url printed by `bk <app> upload <file>`'
          : p.id === 'google_drive'
            ? 'https://drive.google.com/file/d/<id>/view'
            : null,
    })),
    {
      id: String(externalGeneric.id),
      label: externalGeneric.label,
      internal: false,
      example: 'any other https:// url — stored and opened, never embedded',
    },
  ]
}
