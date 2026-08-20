// npm run db:seed:books
//
// Creates the seed user if absent, then loads the mockup. Idempotent: re-running
// replaces the seeded workspace rather than duplicating it.
//
// LOCAL ONLY. `assertSeedable` refuses production and any non-local host, because
// "replaces the seeded workspace" means deleting it with the protective triggers
// off. It is checked HERE as well as inside `seed()`, so the refusal happens before
// this script inserts the seed user into a database it was never allowed to touch.
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { sql } from 'drizzle-orm'
import { getDb } from '../lib/db/client'
import { seed, assertSeedable } from '../lib/db/seed'

async function main() {
  assertSeedable()

  const db = getDb()
  const email = 'andrea@blackcode.ch'
  const found = await db.execute(sql`SELECT id FROM platform.users WHERE email = ${email}`)
  let userId = (found.rows?.[0] as { id?: number } | undefined)?.id
  if (userId === undefined) {
    const made = await db.execute(
      sql`INSERT INTO platform.users (email, name) VALUES (${email}, 'Andrea') RETURNING id`
    )
    userId = (made.rows?.[0] as { id: number }).id
    console.log(`created seed user ${email} (#${userId})`)
  }
  const { workspaceId } = await seed(userId!)
  console.log(`seeded workspace #${workspaceId}`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
