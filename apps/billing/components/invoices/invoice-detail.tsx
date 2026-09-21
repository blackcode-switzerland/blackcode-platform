'use client'

// One invoice: a hero summary, its lines, totals, the derived payment block,
// the issuer copy, its recurrence, its document preview and its history — and
// every action `bk billing invoice` has. Every field, action and data-testid
// from the minimal test UI's `[ref]/page.tsx` is kept on its equivalent
// element; the raw field-by-field table now lives in a collapsible "All
// fields" block at the bottom (`invoice-fields`/`field-<name>`, unchanged),
// and the once-inline "send" / "void" forms are a modal and a `useConfirm`
// flow — never `window.prompt`.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Ban,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  Mail,
  MailCheck,
  MoreHorizontal,
  QrCode,
  Repeat,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Input } from '@blackcode/platform-ui/ui/input'
import { DatePicker } from '@blackcode/platform-ui/ui/date-picker'
import { useConfirm } from '@blackcode/platform-ui/ui/confirm-dialog'
import { PageHeader, PageBody } from '@/components/shell'
import {
  CodeBlock,
  DateText,
  ErrorState,
  FieldList,
  formatDate,
  FormField,
  LoadingState,
  Money,
  Section,
  StatusBadge,
  Textarea,
} from '@/components/ui-kit'
import {
  invoicePdfUrl,
  useAudit,
  useInvoice,
  useInvoiceQr,
  useRecurrence,
} from '@/lib/queries'
import {
  toastError,
  useMarkPaid,
  useMarkSent,
  usePatchInvoice,
  useSetInvoiceLines,
  useVoidInvoice,
} from '@/lib/mutations'
import { amountClassFor, frequencyLabel } from '@/lib/ui-vocab'
import { cn } from '@/lib/utils'
import type { CreateInvoiceLineBody, StructuredAddress } from '@/types'
import { LineItemsEditor } from './line-items-editor'
import { SendInvoiceModal } from './send-invoice-modal'
import { MakeRecurringModal } from './make-recurring-modal'

function addressLine(a: StructuredAddress): string {
  return [a.name, a.street, a.building, a.postal_code, a.city, a.country].filter(Boolean).join(', ')
}

function toEditableLines(items: { description: string; qty: string; unit: string | null; unit_price: string; vat_rate: string | null }[]): CreateInvoiceLineBody[] {
  return items.map((l) => ({ description: l.description, qty: l.qty, unit: l.unit, unit_price: l.unit_price, vat_rate: l.vat_rate }))
}

/** `sm` and up shows the full action row; below it, a primary action + "More". One in the DOM at a time — never both (data-table.tsx's rule: two copies of one testid breaks a strict-mode locator). */
function useDesktopActions(): boolean {
  const [desktop, setDesktop] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    const on = () => setDesktop(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return desktop
}

interface MenuItem {
  key: string
  label: string
  icon: LucideIcon
  onClick?: () => void
  href?: string
  download?: boolean
  testId?: string
  disabled?: boolean
  destructive?: boolean
}

/** The mobile action row's "More" — every item still carries its own `data-testid`, so a script reaches it the same way regardless of screen width. */
function ActionMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} data-testid="actions-more">
        <MoreHorizontal size={14} />
        More
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg">
          {items.map((it) =>
            it.href ? (
              <a
                key={it.key}
                href={it.href}
                target={it.download ? undefined : '_blank'}
                rel={it.download ? undefined : 'noreferrer'}
                download={it.download}
                data-testid={it.testId}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cn('flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent', it.destructive && 'text-destructive')}
              >
                <it.icon size={14} />
                {it.label}
              </a>
            ) : (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                data-testid={it.testId}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false)
                  it.onClick?.()
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
                  it.destructive && 'text-destructive'
                )}
              >
                <it.icon size={14} />
                {it.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}

export function InvoiceDetailPage({ ws, ref }: { ws: string; ref: string }) {
  const inv = useInvoice(ws, ref)
  const audit = useAudit(ws, { subject: `invoice:${ref}`, limit: 100 })
  const qr = useInvoiceQr(ws, ref, { enabled: false })
  const desktopActions = useDesktopActions()

  const patch = usePatchInvoice(ws)
  const setLines = useSetInvoiceLines(ws)
  const markSent = useMarkSent(ws)
  const markPaid = useMarkPaid(ws)
  const voidInvoice = useVoidInvoice(ws)
  const { prompt } = useConfirm()

  const [sendOpen, setSendOpen] = useState(false)
  const [recurringOpen, setRecurringOpen] = useState(false)

  const [messageDraft, setMessageDraft] = useState<string | null>(null)
  const [dueDraft, setDueDraft] = useState<string | null | undefined>(undefined)
  const [externalRefDraft, setExternalRefDraft] = useState<string | null>(null)
  const [editingClient, setEditingClient] = useState<StructuredAddress | null>(null)
  const [editingLines, setEditingLines] = useState<CreateInvoiceLineBody[] | null>(null)

  const i = inv.data
  const recurrence = useRecurrence(ws, i?.recurrence ?? null, { enabled: !!i?.recurrence })

  if (inv.error) {
    return (
      <>
        <PageHeader title="Invoice" breadcrumb={[{ label: 'Invoices', href: `/dashboard/${ws}/invoices` }]} />
        <PageBody>
          <ErrorState error={inv.error} retry={inv.refetch} testId="load-error" />
        </PageBody>
      </>
    )
  }

  if (!i) {
    return (
      <>
        <PageHeader title="Invoice" breadcrumb={[{ label: 'Invoices', href: `/dashboard/${ws}/invoices` }]} />
        <PageBody>
          <LoadingState variant="detail" />
        </PageBody>
      </>
    )
  }

  const draft = i.status === 'draft'
  const canVoid = i.status !== 'void'
  const problems = i.derived.problems

  const doVoid = async () => {
    const reason = await prompt({
      title: `Void ${i.number}`,
      description: 'A void cannot be undone. The number stays consumed.',
      inputLabel: 'Reason',
      placeholder: 'Why is this being voided?',
    })
    if (reason === null) return
    const typed = await prompt({
      title: `Type ${i.number} to confirm`,
      description: 'This is the last step — voiding cannot be undone.',
      inputLabel: 'Invoice number',
      placeholder: i.number,
      requireMatch: i.number,
      confirmLabel: 'Void',
      destructive: true,
    })
    if (typed === null) return
    try {
      await voidInvoice.mutateAsync({ ref: i.seq, body: { reason_en: reason, confirm: typed } })
      toast.success('Voided — this cannot be undone')
    } catch (err) {
      toastError(err)
    }
  }

  const doMarkSent = async () => {
    try {
      await markSent.mutateAsync({ ref: i.seq })
      toast.success('Marked sent — delivered outside this app')
    } catch (err) {
      toastError(err)
    }
  }

  const doMarkPaid = async () => {
    const today = new Date().toISOString().slice(0, 10)
    const typed = await prompt({
      title: `Mark ${i.number} paid`,
      description: 'An assertion that money arrived — not undoable.',
      inputLabel: 'Paid on (YYYY-MM-DD)',
      placeholder: today,
      defaultValue: today,
    })
    if (typed === null) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(typed)) {
      toast.error('Use YYYY-MM-DD')
      return
    }
    if (typed > today) {
      toast.error('The paid date cannot be in the future')
      return
    }
    try {
      await markPaid.mutateAsync({ ref: i.seq, paid_date: typed })
      toast.success('Marked paid — this cannot be undone')
    } catch (err) {
      toastError(err)
    }
  }

  const saveMessage = async () => {
    try {
      await patch.mutateAsync({ ref: i.seq, patch: { message: (messageDraft ?? '').trim() || null } })
      toast.success('Payment message saved')
      setMessageDraft(null)
    } catch (err) {
      toastError(err)
    }
  }

  const saveDue = async () => {
    try {
      await patch.mutateAsync({ ref: i.seq, patch: { due_date: dueDraft ?? null } })
      toast.success('Due date saved')
      setDueDraft(undefined)
    } catch (err) {
      toastError(err)
    }
  }

  const saveExternalRef = async () => {
    try {
      await patch.mutateAsync({ ref: i.seq, patch: { external_ref: (externalRefDraft ?? '').trim() || null } })
      toast.success('External reference saved')
      setExternalRefDraft(null)
    } catch (err) {
      toastError(err)
    }
  }

  const saveClient = async () => {
    if (!editingClient) return
    try {
      await patch.mutateAsync({ ref: i.seq, patch: { client: editingClient } })
      toast.success('Client saved')
      setEditingClient(null)
    } catch (err) {
      toastError(err)
    }
  }

  const saveLines = async () => {
    if (!editingLines) return
    try {
      await setLines.mutateAsync({ ref: i.seq, items: editingLines })
      toast.success('Lines replaced')
      setEditingLines(null)
    } catch (err) {
      toastError(err)
    }
  }

  const showQr = async () => {
    try {
      await qr.refetch()
    } catch (err) {
      toastError(err)
    }
  }

  const pdfUrl = invoicePdfUrl(ws, ref)

  // Every action, described once — the desktop row and the mobile "primary +
  // More" read from this rather than keeping two hand-written button lists in
  // sync.
  const previewItem: MenuItem = { key: 'preview', label: 'Preview PDF', icon: FileText, href: pdfUrl, testId: 'pdf-link' }
  const downloadItem: MenuItem = { key: 'download', label: 'Download', icon: Download, href: pdfUrl, download: true, testId: 'pdf-download' }
  const sendItem: MenuItem = { key: 'send', label: 'Send by email', icon: Mail, onClick: () => setSendOpen(true), testId: 'send', disabled: problems.length > 0 }
  const markSentItem: MenuItem = { key: 'mark-sent', label: 'Mark sent', icon: MailCheck, onClick: doMarkSent, testId: 'mark-sent', disabled: problems.length > 0 }
  const markPaidItem: MenuItem = { key: 'mark-paid', label: 'Mark as paid', icon: MailCheck, onClick: doMarkPaid, testId: 'mark-paid' }
  const voidItem: MenuItem = { key: 'void', label: 'Void', icon: Ban, onClick: doVoid, testId: 'void', destructive: true }

  const primary: MenuItem | null = draft ? sendItem : i.status === 'sent' ? markPaidItem : null
  const menuItems: MenuItem[] = [
    previewItem,
    downloadItem,
    ...(draft ? [markSentItem] : []),
    ...(canVoid ? [voidItem] : []),
  ].filter((it) => it.key !== primary?.key)

  return (
    <>
      <PageHeader
        title={i.number}
        titleTestId="invoice-number"
        breadcrumb={[{ label: 'Invoices', href: `/dashboard/${ws}/invoices` }]}
        meta={<StatusBadge kind="invoice" status={i.status} testId="invoice-status" />}
        actions={
          desktopActions ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={pdfUrl} target="_blank" rel="noreferrer" data-testid="pdf-link">
                  <FileText size={14} />
                  Preview PDF
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={pdfUrl} download data-testid="pdf-download">
                  <Download size={14} />
                  Download
                </a>
              </Button>
              {draft && (
                <>
                  <Button size="sm" data-testid="send" disabled={problems.length > 0} onClick={() => setSendOpen(true)}>
                    <Mail size={14} />
                    Send by email
                  </Button>
                  <Button variant="outline" size="sm" data-testid="mark-sent" disabled={problems.length > 0} onClick={doMarkSent}>
                    <MailCheck size={14} />
                    Mark sent
                  </Button>
                </>
              )}
              {i.status === 'sent' && (
                <Button size="sm" data-testid="mark-paid" onClick={doMarkPaid}>
                  <MailCheck size={14} />
                  Mark as paid
                </Button>
              )}
              {canVoid && (
                <Button variant="outline" size="sm" data-testid="void" onClick={doVoid} className="text-destructive hover:text-destructive">
                  <Ban size={14} />
                  Void
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {primary && (
                <Button size="sm" data-testid={primary.testId} disabled={primary.disabled} onClick={primary.onClick}>
                  <primary.icon size={14} />
                  {primary.label}
                </Button>
              )}
              <ActionMenu items={menuItems} />
            </div>
          )
        }
      />
      <PageBody className="space-y-5">
        {/* Hero — the answer to "what is this invoice", at a glance. */}
        <Section padded={false}>
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="font-mono text-2xl font-semibold tabular-nums text-foreground">{i.number}</h2>
                <StatusBadge kind="invoice" status={i.status} />
                {i.recurrence && (
                  <Link
                    href={`/dashboard/${ws}/recurrences/${i.recurrence}`}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    <Repeat size={11} />#{i.recurrence}
                  </Link>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {i.company} · {i.client.name}
                {i.client.city ? `, ${i.client.city}` : ''}
              </p>

              <dl className="mt-4 grid max-w-sm grid-cols-3 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Issued</dt>
                  <dd><DateText value={i.issue_date} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Due</dt>
                  <dd><DateText value={i.due_date} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Paid</dt>
                  <dd><DateText value={i.paid_date} /></dd>
                </div>
              </dl>

              {i.sent_at && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {i.sent_message_id ? (
                    <>
                      Sent <DateText value={i.sent_at} withTime /> by email
                    </>
                  ) : (
                    <>
                      Sent <DateText value={i.sent_at} withTime /> outside the app
                    </>
                  )}
                </p>
              )}
              {i.void && (
                <p className="mt-2 text-xs text-destructive">
                  Voided <DateText value={i.void.ts} withTime /> — {i.void.reason.en}
                </p>
              )}
            </div>

            <div className="shrink-0 text-left sm:text-right">
              <p className="text-xs text-muted-foreground">Total</p>
              <Money
                amount={i.totals.total}
                currency={i.currency}
                className={cn('text-3xl font-semibold', amountClassFor(i.status))}
              />
            </div>
          </div>
        </Section>

        {problems.length > 0 && (
          <div data-testid="problems" className="rounded-lg border border-destructive/25 bg-destructive/5 p-4">
            <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
              <AlertTriangle size={15} />
              Not a valid QR-bill yet — send, mark sent and the PDF will refuse
            </p>
            <ul className="mt-2 space-y-1">
              {problems.map((p, n) => (
                <li key={n} data-testid="problem" className="text-sm text-muted-foreground">
                  <span className="font-mono text-xs text-destructive">[{p.code}]</span> {p.message} — {p.suggestion}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-3">
          {/* Main column — the document itself. */}
          <div className="space-y-5 xl:col-span-2">
            <Section
              title="Lines"
              padded={false}
              actions={
                draft && !editingLines ? (
                  <Button size="sm" variant="outline" onClick={() => setEditingLines(toEditableLines(i.items))}>
                    Edit lines
                  </Button>
                ) : undefined
              }
            >
              {editingLines ? (
                <div className="space-y-3 p-4">
                  <LineItemsEditor items={editingLines} onChange={setEditingLines} />
                  <div className="flex gap-2">
                    <Button size="sm" data-testid="edit-lines" disabled={setLines.isPending} onClick={saveLines}>
                      Replace lines
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingLines(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table data-testid="lines" className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2 sm:px-5">Description</th>
                        <th className="px-4 py-2 text-right">Qty</th>
                        <th className="px-4 py-2">Unit</th>
                        <th className="px-4 py-2 text-right">Price</th>
                        <th className="px-4 py-2 text-right">VAT</th>
                        <th className="px-4 py-2 text-right sm:pr-5">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {i.items.map((l) => (
                        <tr key={l.line_no} className="border-b border-border last:border-b-0">
                          <td className="px-4 py-2.5 sm:px-5">{l.description}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{l.qty}</td>
                          <td className="px-4 py-2.5">{l.unit ?? ''}</td>
                          <td className="px-4 py-2.5 text-right"><Money amount={l.unit_price} /></td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground">{l.vat_rate === null ? 'none' : `${l.vat_rate}%`}</td>
                          <td className="px-4 py-2.5 text-right sm:pr-5"><Money amount={l.line_total} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div data-testid="totals" className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-border px-4 py-3 text-sm sm:px-5">
                    <span className="text-muted-foreground">
                      Subtotal <Money amount={i.totals.subtotal} />
                    </span>
                    <span className="text-muted-foreground">
                      VAT <Money amount={i.totals.vat_total} />
                    </span>
                    {i.totals.rounding !== '0.00' && (
                      <span className="text-muted-foreground">
                        Rounding <Money amount={i.totals.rounding} />
                      </span>
                    )}
                    <span className="font-semibold">
                      Total <Money testId="total" amount={i.totals.total} currency={i.currency} className={amountClassFor(i.status)} />
                    </span>
                  </div>
                </div>
              )}
            </Section>

            <Section
              title="Client"
              description={draft ? undefined : 'Frozen after send (document_frozen) — void and reissue to change it.'}
              actions={
                draft && !editingClient ? (
                  <Button size="sm" variant="outline" onClick={() => setEditingClient(i.client)}>
                    Edit
                  </Button>
                ) : undefined
              }
            >
              {editingClient ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label="Name" htmlFor="input-client_name">
                      <Input id="input-client_name" data-testid="input-client_name" value={editingClient.name} onChange={(e) => setEditingClient({ ...editingClient, name: e.target.value })} />
                    </FormField>
                    <FormField label="Street">
                      <Input value={editingClient.street ?? ''} onChange={(e) => setEditingClient({ ...editingClient, street: e.target.value || null })} />
                    </FormField>
                    <FormField label="Building">
                      <Input value={editingClient.building ?? ''} onChange={(e) => setEditingClient({ ...editingClient, building: e.target.value || null })} />
                    </FormField>
                    <FormField label="Postal code">
                      <Input value={editingClient.postal_code ?? ''} onChange={(e) => setEditingClient({ ...editingClient, postal_code: e.target.value || null })} />
                    </FormField>
                    <FormField label="City">
                      <Input value={editingClient.city ?? ''} onChange={(e) => setEditingClient({ ...editingClient, city: e.target.value || null })} />
                    </FormField>
                    <FormField label="Country">
                      <Input value={editingClient.country ?? ''} onChange={(e) => setEditingClient({ ...editingClient, country: e.target.value.toUpperCase() || null })} maxLength={2} />
                    </FormField>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" data-testid="edit-client" disabled={patch.isPending} onClick={saveClient}>
                      Save client
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingClient(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm">{addressLine(i.client)}</p>
              )}
            </Section>

            <Section title="Edit" description="Open after send too — the rest of the document is frozen.">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Payment message" htmlFor="input-message">
                  <Textarea
                    id="input-message"
                    data-testid="input-message"
                    rows={2}
                    value={messageDraft ?? i.message ?? ''}
                    onChange={(e) => setMessageDraft(e.target.value)}
                  />
                  <Button size="sm" variant="outline" className="mt-2" data-testid="edit-message" disabled={patch.isPending} onClick={saveMessage}>
                    Save message
                  </Button>
                </FormField>
                <FormField label="Due date" hint="Not frozen — open at any status">
                  <DatePicker value={dueDraft === undefined ? i.due_date : dueDraft} onChange={(v) => setDueDraft(v)} placeholder="YYYY-MM-DD" />
                  <Button size="sm" variant="outline" className="mt-2" data-testid="edit-due" disabled={patch.isPending} onClick={saveDue}>
                    Save due date
                  </Button>
                </FormField>
                <FormField label="External reference" htmlFor="input-external_ref">
                  <Input
                    id="input-external_ref"
                    data-testid="input-external_ref"
                    value={externalRefDraft ?? i.external_ref ?? ''}
                    onChange={(e) => setExternalRefDraft(e.target.value)}
                  />
                  <Button size="sm" variant="outline" className="mt-2" data-testid="edit-external-ref" disabled={patch.isPending} onClick={saveExternalRef}>
                    Save reference
                  </Button>
                </FormField>
              </div>
            </Section>
          </div>

          {/* Side column — the surrounding context. */}
          <div className="space-y-5">
            {i.derived.has_payment_part && (
              <Section title="Payment part" description="From this invoice's own derived block — never recomputed here.">
                <FieldList
                  items={[
                    { label: 'Account', value: i.derived.account_formatted ?? '—' },
                    { label: 'Creditor', value: addressLine(i.derived.creditor) },
                    { label: 'Reference', value: i.derived.reference_formatted ?? '—' },
                  ]}
                />
                <div className="mt-3">
                  <Button size="sm" variant="outline" data-testid="qr-show" onClick={showQr} disabled={qr.isFetching}>
                    <QrCode size={14} />
                    {qr.isFetching ? 'Loading…' : 'Show QR payload'}
                  </Button>
                  {qr.data !== undefined && qr.data !== '' && (
                    <div className="mt-3">
                      <CodeBlock testId="qr-payload" label="QR-bill payload" value={qr.data} />
                    </div>
                  )}
                  {qr.error && <ErrorState error={qr.error} className="mt-3" compact />}
                </div>
              </Section>
            )}

            <Section title="Document preview" padded={false}>
              <div className="mx-4 mt-4 overflow-hidden rounded-lg border border-border bg-muted/20" style={{ aspectRatio: '1 / 1.4142' }}>
                <iframe src={pdfUrl} title={`${i.number} — PDF preview`} className="h-full w-full" />
              </div>
              <div className="px-4 pb-4 pt-2">
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="pdf-preview-open"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Open full size
                  <ExternalLink size={11} />
                </a>
              </div>
            </Section>

            <Section
              title="Recurring"
              actions={
                !i.recurrence && i.status !== 'void' ? (
                  <Button size="sm" variant="outline" data-testid="make-recurring" onClick={() => setRecurringOpen(true)}>
                    <Repeat size={14} />
                    Make recurring…
                  </Button>
                ) : undefined
              }
            >
              {i.recurrence ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="inline-flex items-center gap-1 font-mono">
                      <Repeat size={13} className="text-muted-foreground" />#{i.recurrence}
                    </span>
                    {recurrence.data && <StatusBadge kind="recurrence" status={recurrence.data.status} />}
                  </div>
                  {recurrence.data && (
                    <p className="text-xs text-muted-foreground">
                      {recurrence.data.occurrences_done}/{recurrence.data.occurrences_total} · {frequencyLabel(recurrence.data.frequency)}
                    </p>
                  )}
                  {recurrence.data?.next_date && (
                    <p className="text-xs text-muted-foreground">
                      Next: {recurrence.data.next_period} on <DateText value={recurrence.data.next_date} />
                    </p>
                  )}
                  {recurrence.data?.status === 'completed' && (
                    <p className="text-xs text-muted-foreground">Stops after {recurrence.data.occurrences_total} occurrences.</p>
                  )}
                  <Link href={`/dashboard/${ws}/recurrences/${i.recurrence}`} data-testid="recurrence-link" className="text-xs text-primary hover:underline">
                    View series →
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Not part of a series.</p>
              )}
            </Section>

            {i.issuer && (
              <Section
                title={`As issued on ${formatDate(i.issuer.captured_at, true)}`}
                description={i.issuer.backfilled ? 'Backfilled by a migration, not evidence of what a client received.' : undefined}
              >
                <FieldList
                  items={[
                    { label: 'Legal name', value: i.issuer.legal_name },
                    { label: 'Address', value: [i.issuer.street, i.issuer.building, i.issuer.postal_code, i.issuer.city, i.issuer.country].filter(Boolean).join(', ') || '—' },
                    { label: 'VAT', value: i.issuer.vat_registered ? (i.issuer.vat_number ?? i.issuer.uid ?? 'registered') : 'not registered' },
                  ]}
                />
              </Section>
            )}

            <Section title="History" padded={false}>
              <ErrorState error={audit.error} testId="audit-error" className="m-4" />
              {audit.isPending ? (
                <LoadingState className="p-4" />
              ) : (
                <ul data-testid="audit" className="divide-y divide-border">
                  {audit.data?.data.map((a) => (
                    <li key={a.seq} className="px-4 py-2.5 text-xs sm:px-5">
                      <p className="text-foreground">
                        {a.action}
                        {a.field ? <span className="text-muted-foreground"> · {a.field}</span> : null}
                      </p>
                      <p className="mt-0.5 text-muted-foreground">{a.detail_en ?? `${a.from_value ?? ''} → ${a.to_value ?? ''}`}</p>
                      <p className="mt-0.5 text-muted-foreground">
                        <DateText value={a.ts} withTime /> · {a.actor.email ?? '—'} ({a.actor.via})
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>

        {/* The raw field-by-field record — every value from the minimal test UI,
            unchanged, for a script or a reader who wants the literal wire values
            rather than the designed summary above. Closed by default; its
            content stays in the DOM (a native <details>, not unmounted), so the
            `field-<name>` testids keep working either way. */}
        <details data-testid="invoice-fields" className="group overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-foreground sm:px-5">
            All fields
            <ChevronDown size={16} className="text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border px-4 py-4 sm:px-5">
            <FieldList
              items={[
                { label: '#', value: i.seq, testId: 'field-#' },
                { label: 'Status', value: i.status, testId: 'field-status' },
                { label: 'Company', value: i.company, testId: 'field-company' },
                { label: 'Client', value: addressLine(i.client), testId: 'field-client' },
                { label: 'Issued', value: i.issue_date, testId: 'field-issued' },
                { label: 'Due', value: i.due_date ?? '—', testId: 'field-due' },
                { label: 'Paid', value: i.paid_date ?? '—', testId: 'field-paid' },
                { label: 'Currency', value: i.currency, testId: 'field-currency' },
                { label: 'Language', value: i.language, testId: 'field-language' },
                { label: 'Reference', value: `${i.ref_type} ${i.derived.reference_formatted ?? '—'}`, testId: 'field-reference' },
                {
                  label: 'Pay to',
                  value: i.derived.has_payment_part ? `${i.derived.account_formatted ?? '—'} ${i.derived.creditor.name}` : 'no payment part',
                  testId: 'field-pay-to',
                },
                { label: 'Message', value: i.message ?? '—', testId: 'field-message' },
                {
                  label: 'Issuer',
                  value: i.issuer ? `copied ${i.issuer.captured_at}${i.issuer.backfilled ? ' (backfilled)' : ''}` : 'live (draft)',
                  testId: 'field-issuer',
                },
                { label: 'Series', value: i.recurrence ? `#${i.recurrence} ${i.occurrence_period ?? '(template)'}` : '—', testId: 'field-series' },
                {
                  label: 'Sent',
                  value: i.sent_at ? `${i.sent_at}${i.sent_message_id ? ` message ${i.sent_message_id}` : ' (sent outside this app)'}` : '—',
                  testId: 'field-sent',
                },
                { label: 'Void', value: i.void ? `${i.void.ts} — ${i.void.reason.en}` : '—', testId: 'field-void' },
              ]}
            />
          </div>
        </details>
      </PageBody>

      <SendInvoiceModal ws={ws} invoice={i} open={sendOpen} onClose={() => setSendOpen(false)} />
      <MakeRecurringModal ws={ws} invoice={i} open={recurringOpen} onClose={() => setRecurringOpen(false)} />
    </>
  )
}
