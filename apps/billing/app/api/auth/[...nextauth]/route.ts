// NextAuth's own handler — browser session machinery, not a product route.
//
// Excluded from the CLI-parity guard for that reason, with the reason recorded
// in `lib/cli-parity.test.ts`. There is no `bk` command here and there must not
// be: an agent authenticates with a `bk_live_…` token, which never touches this
// path.
import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
