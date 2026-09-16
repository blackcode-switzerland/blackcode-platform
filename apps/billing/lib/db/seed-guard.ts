// The seed's refusal to touch anything but a local database.
//
// ===========================================================================
// WHY IT IS A POSITIVE ASSERTION AND NOT A BLOCKLIST
// ===========================================================================
// `scripts/seed.ts` DELETES the workspace it rebuilds. Against production that
// means deleting invoices — numbered legal documents under a ten-year retention
// duty — and migration 0006 revokes DELETE on them, so the attempt would fail
// PART WAY THROUGH and leave a workspace in pieces.
//
// A blocklist ("refuse if the host contains neon.tech") fails the moment a host
// is added that nobody thought of, and it fails SILENTLY — by allowing. So this
// is the other way round: an allowlist of hosts known to be local, and anything
// unrecognised is refused with the host named.
//
// That direction of error costs a developer one message when they add a local
// host. The other direction costs a production database.
//
// ── IT IS ALSO CHECKED BEFORE A CONNECTION IS OPENED ───────────────────────
// `seed.ts` calls this as its first statement. A check after `getDb()` would
// already have opened a client to the database it is about to refuse, which is
// harmless here and is the kind of ordering that stops being harmless when
// somebody adds a `TRUNCATE` to the top of a script.

/** Hosts this seed will write to. Anything else is refused. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', 'host.docker.internal']

/**
 * Throw unless `url` names a local database.
 *
 * Returns nothing on success, deliberately: there is no truthy value a caller
 * could accidentally ignore. A caller that forgets to check gets no protection
 * and a caller that calls it gets all of it.
 */
export function assertLocalDatabase(url: string | undefined): void {
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set, so this seed cannot tell which database it would rebuild. ' +
        'Load apps/billing/.env.local.'
    )
  }

  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error(
      'DATABASE_URL is not a parseable URL, so the host cannot be checked. Refusing: this ' +
        'seed deletes the workspace it rebuilds, and it will not do that against a database ' +
        'it cannot identify.'
    )
  }

  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `refusing to seed ${host}: this seed DELETES the "blackcode" workspace and everything ` +
        `in it, including invoices.\n` +
        `Recognised local hosts are ${LOCAL_HOSTS.join(', ')}. If ${host} really is a local ` +
        `database, add it to LOCAL_HOSTS in lib/db/seed-guard.ts — an allowlist rather than a ` +
        `blocklist, because a blocklist fails by ALLOWING the host nobody thought of.\n` +
        `Production tenants are created empty and billed into; there is nothing to seed there.`
    )
  }
}
