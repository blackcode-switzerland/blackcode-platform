// The four lifecycle writes: send, mark-sent, paid, void.
//
// ===========================================================================
// EACH ONE LOCKS THE INVOICE ROW FIRST
// ===========================================================================
// `SELECT … FOR UPDATE` on the invoice, inside the transaction, before any check.
// Two things depend on it:
//
//   - **Two sends of one draft cannot both mail the client.** Without the lock,
//     two requests both read `draft`, both render, both send — and G3 permits
//     the second write, because `sent → sent` is not a transition. The client
//     gets two invoices and the audit log gets two `sent` rows.
//   - **A send cannot race a line edit.** `setInvoiceLines` takes the same lock
//     first (see its comment), so a PDF is always rendered from the lines the
//     database will keep.
//
// Every read inside the transaction goes through `tx`, never `getDb()`: see
// `Exec` in invoices.ts for the deadlock a second pooled connection causes.
//
// ===========================================================================
// SEND HOLDS THE LOCK ACROSS THE EMAIL, ON PURPOSE
// ===========================================================================
// The alternative — commit `sent`, then mail — marks a bill sent that may never
// arrive, and G3 forbids walking it back (`sent → draft` is not a transition).
// The other alternative — mail, then lock and write — reopens the double-send.
// Holding one row lock for the length of one HTTPS call to the transport is the
// cheapest correct option: it blocks only other writes to THIS invoice.
//
// ===========================================================================
// THE ONE FAILURE NO ORDERING REMOVES
// ===========================================================================
// The mail is accepted and then the commit fails (a dropped connection). The
// client has the bill and the database says `draft`. Two things contain it:
//
//   1. The transport call carries an idempotency key derived from WHAT was sent
//      (recipient, copies, subject, body, PDF fingerprint). A retry of the same
//      send within the transport's window is accepted without a second delivery.
//   2. The refusal says so in words — `delivered_not_recorded`, naming the
//      message id and `mark-sent` as the recovery — and an `error_events` row
//      carries the same facts for whoever reads the errors tab.

import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { insertErrorEvent } from '@blackcode/platform-db'
import { billingCompany, billingInvoice } from '../schema'
import { getDb } from '../client'
import type { Tx } from './seq'
import { appendAudit } from './audit'
import {
  assertLinesAgainstCompany,
  assertMessage,
  assertRefTypeAgainstCompany,
  getInvoice,
  getInvoiceDocumentSource,
  InvoiceRefused,
  type WriteCtx,
} from './invoices'
import { issuerSnapshot } from '@/lib/issuer'
import { prepareInvoiceDocument, type DocumentSource } from '@/lib/delivery/document'
import { emailEnabled, sendDocumentEmail } from '@/lib/email/send'
import { date as formatDate, money } from '@/lib/derive/format'
import { parseRappen } from '@/lib/derive/money'
import { DELIVERY_LIMITS } from '@/lib/limits'
import { APP_SLUG } from '@/lib/app'
import type {
  DocumentLanguage,
  Invoice,
  MarkPaidBody,
  SendInvoiceBody,
  VoidInvoiceBody,
} from '@/types'

/** A lifecycle write knows who is acting by email too: a void record names them. */
export interface LifecycleCtx extends WriteCtx {
  actorEmail: string
}

type CompanyRow = typeof billingCompany.$inferSelect

// ===========================================================================
// Input parsing — pure, exported, tested without a database
// ===========================================================================

/**
 * Deliberately narrow: one `@`, a dot in the domain, no whitespace, no list
 * separators. It is not RFC 5322, and is not trying to be — its job is to refuse
 * "a@b.ch, c@d.ch" typed into `to` (which a transport may accept as two
 * recipients) and a bare name, before anything is rendered.
 */
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/

export function parseSendInput(raw: unknown): Required<Pick<SendInvoiceBody, 'to'>> & {
  cc: string[]
  subject: string | null
  body: string | null
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvoiceRefused('invalid_body', 'a JSON body with `to` is required', 'bk billing invoice send <ref> --to client@example.ch')
  }
  const b = raw as Record<string, unknown>
  const to = typeof b.to === 'string' ? b.to.trim() : ''
  if (!to) {
    throw new InvoiceRefused('recipient_required', '`to` is required: the address the invoice is mailed to', 'bk billing invoice send <ref> --to client@example.ch')
  }
  if (!EMAIL_RE.test(to)) {
    throw new InvoiceRefused('invalid_recipient', `${JSON.stringify(to)} is not one email address`, 'pass exactly one address to --to; put further recipients in --cc')
  }

  let cc: string[] = []
  if (b.cc !== undefined && b.cc !== null) {
    if (!Array.isArray(b.cc) || b.cc.some((c) => typeof c !== 'string')) {
      throw new InvoiceRefused('invalid_cc', '`cc` is an array of email addresses', 'repeat --cc once per address')
    }
    cc = (b.cc as string[]).map((c) => c.trim()).filter((c) => c.length > 0)
    const bad = cc.find((c) => !EMAIL_RE.test(c))
    if (bad) {
      throw new InvoiceRefused('invalid_cc', `${JSON.stringify(bad)} in cc is not one email address`, 'repeat --cc once per address')
    }
    if (cc.length > DELIVERY_LIMITS.cc_max) {
      throw new InvoiceRefused('too_many_cc', `${cc.length} copies; the limit is ${DELIVERY_LIMITS.cc_max}`, 'a bill goes to the people who pay it, not to a list')
    }
  }

  const text = (key: 'subject' | 'body', max: number): string | null => {
    const v = b[key]
    if (v === undefined || v === null) return null
    if (typeof v !== 'string') {
      throw new InvoiceRefused(`invalid_${key}`, `\`${key}\` is text`, `omit it to use the default ${key} in the invoice's language`)
    }
    const t = v.trim()
    if (t.length > max) {
      throw new InvoiceRefused(`${key}_too_long`, `the ${key} is ${t.length} characters; the limit is ${max}`, `shorten it, or omit it to use the default`)
    }
    return t.length > 0 ? t : null
  }

  return { to, cc, subject: text('subject', DELIVERY_LIMITS.subject_max), body: text('body', DELIVERY_LIMITS.body_max) }
}

/** Today's date where the businesses using this app are, as YYYY-MM-DD. */
export function todayInZurich(now: Date = new Date()): string {
  // `en-CA` formats as YYYY-MM-DD. Zurich, not UTC: between midnight and 01:00
  // or 02:00 local time, UTC is still yesterday, and "paid today" would be
  // refused as a future date for an hour every night.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(now)
}

export function parsePaidInput(raw: unknown, now: Date = new Date()): MarkPaidBody {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).paid_date : undefined
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new InvoiceRefused('paid_date_required', '`paid_date` is required, as YYYY-MM-DD', 'bk billing invoice paid <ref> --date 2026-10-02')
  }
  // Round-trip through UTC to catch 2026-02-30. This is the one place a `Date` is
  // constructed from a date string, and only to validate it — never to format
  // one (lib/derive/format.ts explains why).
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new InvoiceRefused('invalid_paid_date', `${v} is not a calendar date`, 'YYYY-MM-DD')
  }
  // ISO dates compare correctly as strings.
  if (v > todayInZurich(now)) {
    throw new InvoiceRefused(
      'paid_date_in_future',
      `${v} is in the future; marking an invoice paid asserts that the money HAS arrived`,
      'mark it paid on the day the payment shows in the account'
    )
  }
  return { paid_date: v }
}

export function parseVoidInput(raw: unknown): { reason: { fr: string; en: string }; confirm: string | null } {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const pick = (k: string): string => (typeof b[k] === 'string' ? (b[k] as string).trim() : '')
  const fr = pick('reason_fr')
  const en = pick('reason_en')
  if (!fr && !en) {
    throw new InvoiceRefused(
      'void_reason_required',
      'a void needs a reason: the record of WHY is what makes it a cancellation rather than a deletion',
      'bk billing invoice void <ref> --reason "Issued to the wrong entity" --confirm <number>'
    )
  }
  for (const [k, v] of [['reason_fr', fr], ['reason_en', en]] as const) {
    if (v.length > DELIVERY_LIMITS.void_reason_max) {
      throw new InvoiceRefused('void_reason_too_long', `${k} is ${v.length} characters; the limit is ${DELIVERY_LIMITS.void_reason_max}`, 'one sentence a fiduciary can read in five years')
    }
  }
  // One reason serves both languages. Requiring a translation to cancel a bill
  // would make the cancellation wait for a translator, and a reason in one
  // language is a complete record.
  const confirm = typeof b.confirm === 'string' ? b.confirm : null
  return { reason: { fr: fr || en, en: en || fr }, confirm }
}

/**
 * `--confirm` against the invoice's printed number. EXACT: no trimming here, no
 * case folding. The CLI trims what the person typed before it sends it, so a
 * value that reaches this function with spaces in it was sent that way on
 * purpose, and "close enough" is not a standard for authorising a void.
 *
 * 409 with "required" in the message: `bk` maps a 409 to exit 2, the same code
 * its own local `--confirm` pre-check exits with — "a pre-check in the binary
 * must exit the same code the server would" (cli/cmd/bk/main.go, `classify`).
 */
export function assertConfirmMatches(confirm: string | null, number: string): void {
  if (confirm === null) return
  if (confirm !== number) {
    throw new InvoiceRefused(
      'confirm_mismatch',
      `confirm is required to match the invoice number exactly: expected ${number}, got ${JSON.stringify(confirm)}`,
      `--confirm ${number}`,
      409
    )
  }
}

// ===========================================================================
// Readiness — pure
// ===========================================================================

/**
 * Can this invoice be ISSUED — mailed by us, or recorded as delivered elsewhere?
 *
 * The write-door rules run again here, not only at create, because a draft is
 * edited after it is created: a company can lose its QR-IBAN, stop being
 * VAT-registered, or have a draft switched to QRR by a PATCH that did not
 * re-check. The last chance to catch any of those is before the document is out
 * of our hands.
 */
export function assertReadyToIssue(invoice: Invoice, company: CompanyRow): void {
  const n = invoice.number
  if (company.retired_at) {
    throw new InvoiceRefused('company_retired', `company ${company.slug} was retired and issues no new invoices`, `void ${n} with a reason, or un-retire the company`, 409)
  }
  if (invoice.items.length === 0) {
    throw new InvoiceRefused('no_lines', `invoice ${n} has no lines, so it is a bill for nothing`, `bk billing invoice line set ${invoice.seq} --item "desc|1|pcs|100.00"`, 409)
  }
  if (!invoice.client?.name?.trim()) {
    throw new InvoiceRefused('no_client', `invoice ${n} has no client name, so it is addressed to nobody`, `bk billing invoice edit ${invoice.seq} --client-name "…"`, 409)
  }
  // `parseRappen`, not `parseMinor(total, 2)`: parseMinor's second argument is a
  // MULTIPLIER (100), not a count of decimal places. The first draft passed 2,
  // which permits zero decimals — so every total ending in .00 passed and a
  // real one like 540.50 threw a 500 out of this function. The unit test used
  // 1590.00 and could not see it; the first HTTP send of a bill with cents did.
  if (parseRappen(invoice.totals.total) <= 0) {
    throw new InvoiceRefused(
      'total_not_positive',
      `invoice ${n} totals ${invoice.currency} ${invoice.totals.total}; a bill asks for a positive amount`,
      'credit notes are not modelled yet — void the original with a reason instead',
      409
    )
  }
  if (invoice.ref_type === 'QRR') {
    assertRefTypeAgainstCompany('QRR', invoice.currency, company.qr_iban)
  } else if (!company.iban) {
    throw new InvoiceRefused(
      'company_has_no_iban',
      `company ${company.slug} has no IBAN, so invoice ${n} would tell the client to pay nowhere`,
      `ask the workspace owner: bk billing company edit ${company.slug} --iban CH…`,
      409
    )
  }
  assertLinesAgainstCompany(invoice.items, company.vat_registered, company.slug)
  assertMessage(invoice.message)
}

/** Refused rather than defaulted: a status the caller did not expect is a question, not a no-op. */
function assertDraft(invoice: { number: string; status: string; seq: number }, verb: 'send' | 'mark-sent'): void {
  if (invoice.status === 'draft') return
  const n = invoice.number
  const next: Record<string, string> = {
    sent: `it already went out — bk billing invoice show ${invoice.seq}`,
    paid: `it was sent and paid — bk billing invoice show ${invoice.seq}`,
    void: `it was voided and keeps its number — create a new invoice`,
  }
  throw new InvoiceRefused(
    invoice.status === 'void' ? 'invoice_void' : 'already_sent',
    `invoice ${n} is ${invoice.status}; only a draft can be ${verb === 'send' ? 'sent' : 'marked sent'}`,
    next[invoice.status] ?? `bk billing invoice show ${invoice.seq}`,
    409
  )
}

// ===========================================================================
// Email copy — pure
// ===========================================================================

/**
 * The default subject and covering note, in the DOCUMENT's language.
 *
 * The document's language, not the operator's: the reader of this mail is the
 * client, and the invoice attached to it is in that language already.
 */
export function defaultEmailCopy(invoice: Invoice, companyName: string): { subject: string; body: string } {
  const amount = money(invoice.totals.total, invoice.currency)
  const due = invoice.due_date ? formatDate(invoice.due_date) : null
  const n = invoice.number
  const copy: Record<DocumentLanguage, { subject: string; body: string }> = {
    fr: {
      subject: `Facture ${n} – ${companyName}`,
      body:
        `Bonjour,\n\nVeuillez trouver ci-joint notre facture ${n} d’un montant de ${amount}` +
        (due ? `, payable d’ici au ${due}.` : '.') +
        `\n\nNous vous remercions de votre confiance.\n\nMeilleures salutations,\n${companyName}`,
    },
    de: {
      subject: `Rechnung ${n} – ${companyName}`,
      body:
        `Guten Tag\n\nIm Anhang erhalten Sie unsere Rechnung ${n} über ${amount}` +
        (due ? `, zahlbar bis ${due}.` : '.') +
        `\n\nVielen Dank für Ihr Vertrauen.\n\nFreundliche Grüsse\n${companyName}`,
    },
    it: {
      subject: `Fattura ${n} – ${companyName}`,
      body:
        `Buongiorno,\n\nin allegato trovate la nostra fattura ${n} di ${amount}` +
        (due ? `, pagabile entro il ${due}.` : '.') +
        `\n\nVi ringraziamo per la fiducia.\n\nCordiali saluti,\n${companyName}`,
    },
    en: {
      subject: `Invoice ${n} – ${companyName}`,
      body:
        `Hello,\n\nPlease find attached our invoice ${n} for ${amount}` +
        (due ? `, payable by ${due}.` : '.') +
        `\n\nThank you for your business.\n\nKind regards,\n${companyName}`,
    },
  }
  return copy[invoice.language] ?? copy.en
}

/** `BC-2026-0033.pdf`. Anything outside a safe set becomes `-`, because a number format is free text and a filename is not. */
export function documentFilename(number: string): string {
  return `${number.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`
}

/**
 * The transport's idempotency key: WHAT is being sent, not WHEN.
 *
 * Same invoice, same recipients, same words, same PDF → same key, so a retry is
 * delivered once. Change any of them — a corrected address after a bounce — and
 * the key changes, so the corrected send is not swallowed as a duplicate of the
 * failed one. `cc` is sorted: the order a person typed copies in is not part of
 * what was sent.
 */
export function transportIdempotencyKey(
  workspaceId: number,
  invoiceId: number,
  sent: { to: string; cc: string[]; subject: string; body: string; pdfSha256: string }
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([sent.to.toLowerCase(), [...sent.cc].map((c) => c.toLowerCase()).sort(), sent.subject, sent.body, sent.pdfSha256]))
    .digest('hex')
    .slice(0, 32)
  return `${APP_SLUG}/invoice-send/${workspaceId}/${invoiceId}/${digest}`
}

// ===========================================================================
// The writes
// ===========================================================================

interface Locked {
  id: number
  seq: number
  number: string
  status: string
  company_id: number
}

async function lockInvoice(tx: Tx, workspaceId: number, ref: string): Promise<Locked> {
  const numeric = /^\d+$/.test(ref) ? Number(ref) : null
  const [row] = await tx
    .select({
      id: billingInvoice.id,
      seq: billingInvoice.seq,
      number: billingInvoice.number,
      status: billingInvoice.status,
      company_id: billingInvoice.company_id,
    })
    .from(billingInvoice)
    .where(
      and(
        eq(billingInvoice.workspace_id, workspaceId),
        numeric === null ? eq(billingInvoice.number, ref) : eq(billingInvoice.seq, numeric)
      )
    )
    .limit(1)
    .for('update')
  if (!row) {
    throw new InvoiceRefused('invoice_not_found', `no invoice #${ref} or numbered ${ref} in this workspace`, 'bk billing invoice list', 404)
  }
  return row
}

async function companyOf(tx: Tx, companyId: number): Promise<CompanyRow> {
  const [company] = await tx.select().from(billingCompany).where(eq(billingCompany.id, companyId)).limit(1)
  // A foreign key with ON DELETE RESTRICT and a no-delete trigger stand behind
  // this; reaching it means the catalog disagrees with the migrations.
  if (!company) throw new Error(`invoice's company ${companyId} does not exist`)
  return company
}

/**
 * The draft that is about to be issued, and the copy of its company that goes
 * with it (invariant I12, migration 0011).
 *
 * ONE read of the company row feeds everything: the readiness checks, the
 * snapshot, the totals (through `rounding`), the PDF and the stored `issuer`.
 * The invoice is shaped AS ISSUED BY that snapshot rather than by its own join,
 * so a company edit committing mid-send cannot produce a PDF from one version
 * of the company and a stored copy of another.
 */
async function draftToIssue(tx: Tx, workspaceId: number, locked: Locked) {
  const company = await companyOf(tx, locked.company_id)
  const issuer = issuerSnapshot(company)
  const src = await getInvoiceDocumentSource(workspaceId, String(locked.seq), tx, issuer)
  if (!src) throw new Error(`invoice #${locked.seq} vanished under its own row lock`)
  return { invoice: src.invoice, company, issuer }
}

async function freshRead(workspaceId: number, seq: number): Promise<Invoice> {
  const fresh = await getInvoice(workspaceId, String(seq))
  if (!fresh) throw new Error(`invoice #${seq} not readable after commit`)
  return fresh
}

/** What the send path calls out to. A parameter so its ordering can be tested without a transport. */
export interface DeliveryDeps {
  prepareDocument: (src: DocumentSource) => Promise<Buffer>
  sendDocumentEmail: typeof sendDocumentEmail
  emailEnabled: () => boolean
  log: (line: string) => void
}

const defaultDeps: DeliveryDeps = {
  prepareDocument: prepareInvoiceDocument,
  sendDocumentEmail,
  emailEnabled,
  // eslint-disable-next-line no-console
  log: (line) => console.log(line),
}

/**
 * Mail the invoice with its PDF, and record that it went.
 *
 * **The route has already checked `canDeliverEmail()`** — before this is called,
 * so a deployment that cannot send refuses before anything is read. The order
 * here is the rest of the design:
 *
 *   1. parse the request (no database)
 *   2. lock the invoice; it must be a draft
 *   3. readiness: lines, client, positive total, an account, the write-door rules
 *   4. the document — validated against the QR-bill standard and rendered
 *      (phase 2's seam; refuses until then)
 *   5. mail it. A transport refusal is a 502 and NOTHING changes
 *   6. write `sent`, `sent_at`, the message id and the fingerprint, and the audit
 *      row, in the transaction that has held the lock since step 2
 */
export async function sendInvoice(
  ctx: LifecycleCtx,
  ref: string,
  raw: unknown,
  deps: DeliveryDeps = defaultDeps
): Promise<Invoice> {
  const input = parseSendInput(raw)
  let delivered: { messageId: string | null; number: string; seq: number } | null = null

  try {
    const seq = await getDb().transaction(async (tx) => {
      const locked = await lockInvoice(tx, ctx.workspaceId, ref)
      assertDraft(locked, 'send')
      const { invoice, company, issuer } = await draftToIssue(tx, ctx.workspaceId, locked)
      assertReadyToIssue(invoice, company)
      if (!company.email) {
        throw new InvoiceRefused(
          'company_has_no_email',
          `company ${company.slug} has no email address, so a client replying to invoice ${invoice.number} would reach nobody at ${company.name}`,
          `bk billing company edit ${company.slug} --email billing@…`,
          409
        )
      }

      const pdf = await deps.prepareDocument({ invoice, issuer })
      const pdfSha256 = createHash('sha256').update(pdf).digest('hex')
      const copy = defaultEmailCopy(invoice, company.name)
      const subject = input.subject ?? copy.subject
      const body = input.body ?? copy.body
      const filename = documentFilename(invoice.number)

      const result = await deps.sendDocumentEmail(
        input.to,
        { subject, heading: subject, body, attachmentName: filename },
        {
          cc: input.cc,
          replyTo: company.email,
          attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
          idempotencyKey: transportIdempotencyKey(ctx.workspaceId, locked.id, {
            to: input.to,
            cc: input.cc,
            subject,
            body,
            pdfSha256,
          }),
        }
      )

      let messageId: string | null = null
      let fingerprint: string | null = null
      let detailEn: string
      let detailFr: string
      const recipients = [input.to, ...input.cc].join(', ')

      if (result.sent) {
        messageId = result.messageId ?? null
        fingerprint = pdfSha256
        detailEn = `Emailed to ${recipients} as ${filename} (message ${messageId ?? 'id not returned'}, PDF sha256 ${pdfSha256.slice(0, 12)}…)`
        detailFr = `Envoyée par e-mail à ${recipients} en ${filename} (message ${messageId ?? 'id non retourné'}, PDF sha256 ${pdfSha256.slice(0, 12)}…)`
      } else if (result.skipped === 'not_configured' && !deps.emailEnabled()) {
        // THE DEVELOPMENT CARVE-OUT. The route refused with 503 if this
        // deployment cannot deliver at all, so reaching here with no key means
        // NODE_ENV is not production — `canDeliverEmail()`'s deliberate
        // exception (packages/platform-email/src/client.ts). The flow completes
        // so it can be exercised locally, the server log says what would have
        // gone, and the record says it did NOT go: no message id, no
        // fingerprint, and a detail line that cannot be mistaken for a delivery.
        deps.log(
          `[billing send] ${invoice.number} NOT delivered — no RESEND_API_KEY outside production. ` +
            `to=${recipients} subject=${JSON.stringify(subject)} pdf_sha256=${pdfSha256}`
        )
        detailEn = `Marked sent WITHOUT delivery: this development deployment has no email key (would have gone to ${recipients})`
        detailFr = `Marquée envoyée SANS envoi : ce déploiement de développement n’a pas de clé e-mail (destinataires : ${recipients})`
      } else {
        throw new InvoiceRefused(
          'email_delivery_failed',
          `the email carrying invoice ${invoice.number} was not accepted: ${result.error ?? 'no reason given'}`,
          'nothing was changed and the invoice is still a draft; check the address and send again',
          502
        )
      }

      // ONLY a real delivery. The development path above sent nothing, and a
      // later failure there must not report "WAS emailed" — the first version
      // set this unconditionally, and a verification run with the row lock
      // removed produced two `delivered_not_recorded` refusals for mail that
      // had never left the process.
      if (result.sent) delivered = { messageId, number: invoice.number, seq: invoice.seq }

      await tx
        .update(billingInvoice)
        .set({
          status: 'sent',
          sent_at: new Date(),
          sent_message_id: messageId,
          pdf_sha256: fingerprint,
          // The SAME object the PDF above was rendered from.
          issuer,
          updated_at: new Date(),
        })
        .where(eq(billingInvoice.id, locked.id))
      await appendAudit(tx, {
        workspaceId: ctx.workspaceId,
        subjectType: 'invoice',
        subjectId: locked.id,
        subjectSeq: locked.seq,
        actorUserId: ctx.actorUserId,
        via: ctx.via,
        action: 'sent',
        field: 'status',
        from: 'draft',
        to: 'sent',
        detailEn,
        detailFr,
      })
      return locked.seq
    })
    return await freshRead(ctx.workspaceId, seq)
  } catch (e) {
    // `delivered` is set only after the transport accepted the mail, and the
    // catch runs only when the transaction did not commit. Both together is the
    // one state no ordering removes — see the header.
    const d = delivered as { messageId: string | null; number: string; seq: number } | null
    if (d && !(e instanceof InvoiceRefused)) {
      // Drizzle wraps the Postgres error and puts the reason in `cause`; the
      // wrapper's own message is only the failed SQL. Record both, or the one
      // row that explains a delivered-but-unrecorded bill says nothing useful.
      const cause = (e as { cause?: { message?: string } })?.cause?.message
      await insertErrorEvent(getDb(), {
        app: APP_SLUG,
        level: 'error',
        code: 'invoice_delivered_not_recorded',
        message:
          `invoice ${d.number} was emailed (message ${d.messageId ?? 'unknown'}) and recording it failed: ` +
          `${cause ?? (e as Error)?.message ?? e}`,
        stack: (e as Error)?.stack ?? null,
        route: '/api/workspaces/[ws]/invoices/[ref]/send',
        method: 'POST',
        status_code: 500,
        user_id: ctx.actorUserId,
        context: { workspace_id: ctx.workspaceId, invoice_seq: d.seq, message_id: d.messageId },
      }).catch(() => {})
      throw new InvoiceRefused(
        'delivered_not_recorded',
        `invoice ${d.number} WAS emailed (message ${d.messageId ?? 'unknown'}) but recording the send failed`,
        `do not send it again; record the delivery with \`bk billing invoice mark-sent ${d.seq}\``,
        500
      )
    }
    throw e
  }
}

/** Record that a bill went out some other way: paper, another mailbox, by hand. */
export async function markInvoiceSent(
  ctx: LifecycleCtx,
  ref: string,
  deps: Pick<DeliveryDeps, 'prepareDocument'> = defaultDeps
): Promise<Invoice> {
  const seq = await getDb().transaction(async (tx) => {
    const locked = await lockInvoice(tx, ctx.workspaceId, ref)
    assertDraft(locked, 'mark-sent')
    const { invoice, company, issuer } = await draftToIssue(tx, ctx.workspaceId, locked)
    assertReadyToIssue(invoice, company)
    // Validated like a send, and for the same reason: whatever went out "another
    // way" was this app's PDF, and from now on this invoice's PDF is served to
    // anyone who asks. A bill the standard refuses must not become `sent`.
    await deps.prepareDocument({ invoice, issuer })

    await tx
      .update(billingInvoice)
      // `sent_message_id` and `pdf_sha256` stay NULL, and that is the record:
      // this app did not send it and did not attach anything.
      .set({ status: 'sent', sent_at: new Date(), issuer, updated_at: new Date() })
      .where(eq(billingInvoice.id, locked.id))
    await appendAudit(tx, {
      workspaceId: ctx.workspaceId,
      subjectType: 'invoice',
      subjectId: locked.id,
      subjectSeq: locked.seq,
      actorUserId: ctx.actorUserId,
      via: ctx.via,
      action: 'sent',
      field: 'status',
      from: 'draft',
      to: 'sent',
      detailEn: 'Marked as sent outside this app — no email was sent and no PDF fingerprint was recorded',
      detailFr: 'Marquée comme envoyée hors de l’application — aucun e-mail envoyé, aucune empreinte PDF enregistrée',
    })
    return locked.seq
  })
  return freshRead(ctx.workspaceId, seq)
}

/**
 * Assert that the money arrived.
 *
 * **An assertion, never a computation.** Nothing in this app watches a bank
 * account and nothing here compares an amount: b/books owns the money truth.
 * Do not add `amount_paid`, a partial-payment flow or reconciliation here without
 * a design pass (docs/billing-app-plan/phase-3-lifecycle-and-delivery.md, Notes).
 */
export async function markInvoicePaid(ctx: LifecycleCtx, ref: string, raw: unknown): Promise<Invoice> {
  const { paid_date } = parsePaidInput(raw)
  const seq = await getDb().transaction(async (tx) => {
    const locked = await lockInvoice(tx, ctx.workspaceId, ref)
    const n = locked.number
    if (locked.status === 'draft') {
      throw new InvoiceRefused('not_sent', `invoice ${n} is a draft; nobody has received it, so nobody can have paid it`, `send it first (bk billing invoice send ${locked.seq} --to …), or bk billing invoice mark-sent ${locked.seq} if it went out another way`, 409)
    }
    if (locked.status === 'paid') {
      throw new InvoiceRefused('already_paid', `invoice ${n} is already marked paid`, `bk billing invoice show ${locked.seq}`, 409)
    }
    if (locked.status === 'void') {
      throw new InvoiceRefused('invoice_void', `invoice ${n} was voided; a cancelled bill is not paid`, 'if money arrived for it anyway, that is a refund conversation, and b/books records it', 409)
    }

    await tx
      .update(billingInvoice)
      .set({ status: 'paid', paid_date, updated_at: new Date() })
      .where(eq(billingInvoice.id, locked.id))
    await appendAudit(tx, {
      workspaceId: ctx.workspaceId,
      subjectType: 'invoice',
      subjectId: locked.id,
      subjectSeq: locked.seq,
      actorUserId: ctx.actorUserId,
      via: ctx.via,
      action: 'paid',
      field: 'status',
      from: 'sent',
      to: 'paid',
      detailEn: `Marked paid on ${formatDate(paid_date)} — an assertion that the money arrived; b/billing does not reconcile, b/books does`,
      detailFr: `Marquée payée le ${formatDate(paid_date)} — une affirmation que le paiement est arrivé ; b/billing ne rapproche pas, b/books le fait`,
    })
    return locked.seq
  })
  return freshRead(ctx.workspaceId, seq)
}

/** Cancel with a reason. The number stays consumed forever; nothing is deleted. */
export async function voidInvoice(ctx: LifecycleCtx, ref: string, raw: unknown): Promise<Invoice> {
  const { reason, confirm } = parseVoidInput(raw)
  const seq = await getDb().transaction(async (tx) => {
    const locked = await lockInvoice(tx, ctx.workspaceId, ref)
    assertConfirmMatches(confirm, locked.number)
    if (locked.status === 'void') {
      throw new InvoiceRefused('already_void', `invoice ${locked.number} is already void`, `bk billing invoice show ${locked.seq}`, 409)
    }

    // A draft voided without ever being sent still leaves `draft`, so it takes
    // its issuer copy here (0011's CHECK holds the iff). Its number is consumed
    // and its document still renders — stamped void, with no payment part — and
    // that document must not start changing when the company is next edited.
    const issuer = locked.status === 'draft' ? issuerSnapshot(await companyOf(tx, locked.company_id)) : undefined

    await tx
      .update(billingInvoice)
      .set({
        status: 'void',
        void: { ts: new Date().toISOString(), by: ctx.actorEmail, reason },
        ...(issuer ? { issuer } : {}),
        updated_at: new Date(),
      })
      .where(eq(billingInvoice.id, locked.id))
    await appendAudit(tx, {
      workspaceId: ctx.workspaceId,
      subjectType: 'invoice',
      subjectId: locked.id,
      subjectSeq: locked.seq,
      actorUserId: ctx.actorUserId,
      via: ctx.via,
      action: 'voided',
      field: 'status',
      from: locked.status,
      to: 'void',
      detailEn: `Voided: ${reason.en} — ${locked.number} stays consumed`,
      detailFr: `Annulée : ${reason.fr} — le numéro ${locked.number} reste consommé`,
    })
    return locked.seq
  })
  return freshRead(ctx.workspaceId, seq)
}
