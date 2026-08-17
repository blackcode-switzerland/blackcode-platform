// The provider registry.
//
// ===========================================================================
// ADDING A PROVIDER IS ONE FILE AND ONE LINE HERE
// ===========================================================================
// That is the whole extensibility contract, and it is why `match` declines by
// returning null instead of the registry doing the routing: a provider that
// wants a url has to recognise it, so registration ORDER cannot let one steal
// another's links by being listed first.
//
// Order still matters in exactly one way, and it is deliberate: `blob` is first
// so our own storage is decided before anything else looks at the url. Nothing
// else should ever claim a `blob.vercel-storage.com` url, but if a future
// provider's matcher were sloppy enough to, the file that is OURS — the one the
// delete gate protects — must not be misattributed to somebody else's system.
//
// ===========================================================================
// THE FALLBACK IS A PROVIDER, NOT A NULL
// ===========================================================================
// `externalGeneric` matches everything left over. `describeFile` therefore never
// returns null and no call site needs a null branch — a link to a random host is
// a perfectly good attachment that opens in a new tab, and modelling it as "no
// provider" would push an `if` into every renderer in every app.

import { mediaKindOf } from '../media-kind'
import type { DescribeHints, FileDescriptor, FileProvider } from '../types'
import { blob } from './blob'
import { googleDrive } from './google-drive'

type Match = Omit<FileDescriptor, 'provider' | 'internal' | 'label'>

/**
 * Anything we do not recognise: a link, and nothing more.
 *
 * It never embeds, and that is a decision rather than a gap. Framing an
 * arbitrary third-party page inside our own is how a customer record ends up
 * showing somebody's login form, a cookie banner, or worse — and most hosts
 * refuse to be framed anyway (`X-Frame-Options`), so the "preview" would be a
 * blank rectangle. A card with the hostname is honest and always works.
 */
export const externalGeneric: FileProvider = {
  id: 'external',
  label: 'External link',
  internal: false,
  match(url: URL, hints: DescribeHints): Match {
    const kind = mediaKindOf({ mime: hints.mime, filename: hints.filename ?? url.pathname })
    return {
      external_id: null,
      media_kind: kind,
      embed: { mode: 'none', url: null },
      thumbnail_url: null,
      open_url: url.toString(),
    }
  },
}

/**
 * Every provider that can claim a url, in order. `blob` first — see the header.
 *
 * `externalGeneric` is NOT in this list: it is the fallback `describeFile`
 * applies after all of these decline, and putting it here would make it match
 * first for everything below it.
 */
export const PROVIDERS: FileProvider[] = [blob, googleDrive]

/**
 * Register another provider at runtime — Dropbox, OneDrive, a self-hosted S3.
 *
 * Appended, so it is offered the url after every built-in has declined, and a
 * plugin can therefore never intercept our own storage.
 *
 * Idempotent by `id`: calling it twice with the same provider replaces rather
 * than stacks, because a module evaluated twice (a dev-server hot reload, a
 * test importing the same file from two paths) would otherwise grow the list
 * and make `bk meta`'s provider block report duplicates.
 */
export function registerProvider(provider: FileProvider): void {
  const at = PROVIDERS.findIndex((p) => p.id === provider.id)
  if (at >= 0) PROVIDERS[at] = provider
  else PROVIDERS.push(provider)
}

export { blob, googleDrive }
