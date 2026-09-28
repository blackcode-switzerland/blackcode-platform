'use client'

// API tokens — `platform.api_tokens`, one list across every blackcode app.
//
// A token minted here works against issues too, and one revoked here stops
// working there. That is D-16/§6 and it is the thing a reader is most likely to
// assume otherwise, so the page says it rather than leaving it to be discovered
// by a command failing somewhere else.
//
// Not behind `ui_mode`, for the same reason as the profile page: a token is how
// an agent reaches this product at all, and a browser display preference that
// could take it away would be a permission over the account. See
// `lib/read-only.test.ts`, which allows this file by name and asserts the paths
// it sends to are not `/api/workspaces/…` ones.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { TokensSection, type TokenRow } from '@blackcode/platform-ui/account/account-settings'
import { apiGet, apiSend } from '@/lib/client'
import { ErrorState } from '@/components/states'

interface MintedToken extends TokenRow {
  /** Returned ONCE, at creation. Nothing can show it again. */
  plaintext: string
}

/** API tokens — the shared `TokensSection` (2026-09-28), on `/api/tokens`. */
export function TokenSettings() {
  const qc = useQueryClient()
  const tokens = useQuery({ queryKey: ['tokens'], queryFn: () => apiGet<TokenRow[]>('/api/tokens') })
  const create = useMutation({ mutationFn: (name: string) => apiSend<MintedToken>('POST', '/api/tokens', { name }) })
  const revoke = useMutation({ mutationFn: (id: number) => apiSend<{ deleted: true }>('DELETE', `/api/tokens/${id}`) })
  const fail = (e: Error) => {
    toast.error(e.message)
    throw e
  }

  return (
    <TokensSection
      tokens={tokens.data}
      error={tokens.isError ? <ErrorState error={tokens.error} /> : undefined}
      labels={{
        newTokenDescription:
          'Tokens are how agents reach blackcode. This one will work against every app you have access to, not only b/sales.',
      }}
      formatDate={(iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
      onCopy={(text) =>
        navigator.clipboard.writeText(text).then(
          () => toast.success('Copied'),
          () => toast.error('Could not copy — select the token and copy it by hand')
        )
      }
      onCreate={async (name) => {
        const minted = await create.mutateAsync(name).catch(fail)
        await qc.invalidateQueries({ queryKey: ['tokens'] })
        toast.success('Token created')
        return minted.plaintext
      }}
      onRevoke={async (t) => {
        await revoke.mutateAsync(t.id).catch(fail)
        await qc.invalidateQueries({ queryKey: ['tokens'] })
        toast.success('Token revoked')
      }}
      footer={
        <>
          From a terminal, <code className="rounded bg-muted px-1 py-0.5">bk login</code> does this for you and stores
          the result.
        </>
      }
    />
  )
}
