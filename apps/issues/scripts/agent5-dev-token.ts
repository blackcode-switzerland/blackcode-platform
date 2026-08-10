/**
 * TEMPORARY — agent 5 (multiAppFinalRefactor Phase 4). Delete before reporting.
 *
 * Mints a local dev API token for an existing user so `bk` can be driven against
 * the two local dev servers. Minted through `mintToken`, the same function
 * `POST /api/tokens` uses, so this file contains no hashing of its own — see
 * apps/sales/scripts/seed.ts's `mintDevToken` for the same argument.
 *
 *   DEV_TOKEN=1 npx tsx scripts/agent5-dev-token.ts <user_id>
 */
import { config } from 'dotenv'
import { mintToken } from '@blackcode/platform-auth'
import { db } from '@/lib/db/client'

config({ path: '.env.local' })

if (process.env.NODE_ENV === 'production') {
  console.error('refusing: NODE_ENV=production')
  process.exit(1)
}
if (process.env.DEV_TOKEN !== '1') {
  console.error('refusing: set DEV_TOKEN=1')
  process.exit(1)
}
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  console.error('refusing: DATABASE_URL is not a local address')
  process.exit(1)
}

const userId = Number(process.argv[2])
if (!Number.isInteger(userId) || userId <= 0) {
  console.error('usage: agent5-dev-token.ts <user_id>')
  process.exit(1)
}

mintToken(db, { user_id: userId, name: 'agent5-phase4' })
  .then((minted) => console.log(minted.plaintext))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
