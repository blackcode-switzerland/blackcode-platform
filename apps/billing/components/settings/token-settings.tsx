'use client'

// API tokens — the shared `TokensSection` (2026-09-28), wired to
// `GET/POST /api/tokens` and `DELETE /api/tokens/{id}` (`bk token …`).

import { toast } from 'sonner'
import { TokensSection } from '@blackcode/platform-ui/account/account-settings'
import { useTokens } from '@/lib/queries'
import { useCreateToken, useDeleteToken, toastError } from '@/lib/mutations'
import { ErrorState } from '@/components/ui-kit'
import { APP_NAME, PLATFORM_NAME } from '@/lib/app'

export function TokenSettings() {
  const tokens = useTokens()
  const create = useCreateToken()
  const del = useDeleteToken()
  return (
    <TokensSection
      tokens={tokens.data}
      error={tokens.error ? <ErrorState error={tokens.error} retry={tokens.refetch} /> : undefined}
      labels={{
        newTokenDescription: `Tokens are how agents reach ${PLATFORM_NAME}. This one will work against every app you have access to, not only ${APP_NAME}.`,
      }}
      formatDate={(iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
      onCopy={(text) =>
        navigator.clipboard.writeText(text).then(
          () => toast.success('Copied'),
          () => toast.error('Could not copy — select the token and copy it by hand')
        )
      }
      onCreate={async (name) => {
        try {
          const minted = await create.mutateAsync({ name })
          toast.success('Token created')
          return minted.plaintext
        } catch (e) {
          toastError(e)
          throw e
        }
      }}
      onRevoke={async (t) => {
        try {
          await del.mutateAsync({ id: t.id })
          toast.success(`${t.name} revoked`)
        } catch (e) {
          toastError(e)
          throw e
        }
      }}
      footer={
        <>
          From a terminal, <code className="rounded bg-muted px-1 py-0.5">bk login</code> does this for you and
          stores the result.
        </>
      }
    />
  )
}
