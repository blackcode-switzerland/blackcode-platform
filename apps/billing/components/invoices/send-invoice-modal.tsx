'use client'

// "Send by email" — recipient, subject, body, copies. Limits come from
// `GET /api/meta` (`limits.delivery`), never a copied number. Not undoable:
// the confirm button's own label says so instead of the toast promising an undo.

import { useEffect, useState } from 'react'
import { Modal } from '@blackcode/platform-ui/ui/modal'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Input } from '@blackcode/platform-ui/ui/input'
import { FormField, Textarea } from '@/components/ui-kit'
import { useMeta } from '@/lib/queries'
import { useSendInvoice, toastError } from '@/lib/mutations'
import { toast } from 'sonner'
import type { Invoice } from '@/types'

export function SendInvoiceModal({
  ws,
  invoice,
  open,
  onClose,
}: {
  ws: string
  invoice: Invoice
  open: boolean
  onClose: () => void
}) {
  const meta = useMeta()
  const send = useSendInvoice(ws)
  const limits = meta.data?.limits.delivery

  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTo('')
    setCc('')
    setSubject('')
    setBody('')
    setError(null)
  }, [open])

  const ccList = cc
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!to.trim()) {
      setError('An email to send to is required.')
      return
    }
    if (limits && ccList.length > limits.cc_max) {
      setError(`At most ${limits.cc_max} copies.`)
      return
    }
    try {
      await send.mutateAsync({
        ref: invoice.seq,
        body: {
          to: to.trim(),
          cc: ccList.length ? ccList : undefined,
          subject: subject.trim() || undefined,
          body: body.trim() || undefined,
        },
      })
      toast.success('Sent — this cannot be undone', { description: `${invoice.number} emailed to ${to.trim()}` })
      onClose()
    } catch (err) {
      toastError(err)
      setError(err instanceof Error ? err.message : 'Could not send the invoice.')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Send ${invoice.number} by email`} widthClass="max-w-lg">
      <form data-testid="send-form" onSubmit={submit} className="space-y-4">
        <FormField label="To" htmlFor="input-to" required>
          <Input id="input-to" data-testid="input-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.ch" />
        </FormField>
        <FormField label="Cc" htmlFor="input-cc" hint={limits ? `Comma-separated, up to ${limits.cc_max}` : 'Comma-separated'}>
          <Input id="input-cc" data-testid="input-cc" value={cc} onChange={(e) => setCc(e.target.value)} />
        </FormField>
        <FormField label="Subject" htmlFor="input-subject" hint="Document language's default when left blank">
          <Input
            id="input-subject"
            data-testid="input-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={limits?.subject_max}
          />
        </FormField>
        <FormField label="Message" htmlFor="input-body" hint="Plain text. Document language's default when left blank">
          <Textarea id="input-body" data-testid="input-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={limits?.body_max} />
        </FormField>

        {error && (
          <p role="alert" data-testid="error" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" data-testid="send-submit" disabled={send.isPending}>
            {send.isPending ? 'Sending…' : 'Send — cannot be undone'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
