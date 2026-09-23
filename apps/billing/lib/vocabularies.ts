// The vocabularies: every closed set of values a b/billing surface renders.
//
// ===========================================================================
// WHY THESE ARE SERVED AND NOT HARDCODED ANYWHERE ELSE
// ===========================================================================
// They are DYNAMIC in this platform's sense: they can change without a release
// of the `bk` binary. So the rule is that **no help text and no guide topic
// restates them** — a reader runs `bk meta` instead. A `--help` string listing
// the invoice statuses is confidently wrong the first time one changes, with
// nothing to say so.
//
// `cli/internal/guide/guide_test.go` enforces that, and this file is the subject
// it reads: `vocabularySources["billing"]` points here. **That line was added in
// the same commit as this app's first guide topic**, because CLAUDE.md finding
// #22 is what happens otherwise — b/books went to production with no line there,
// so all eight of its topics had a free pass from the guard for the whole of
// their life, while the section header read `--- PASS`.
//
// The guard's rule is "three values from ONE set", so a two-value vocabulary is
// not carried by it. `MEMBER_ROLES` below is one of those. It is still declared
// here rather than inline, because the point of this file is that there is one
// place to look.
//
// The same argument applies to the web: a component that hardcodes four
// invitation statuses needs a deploy to render a fifth. So the colour travels
// WITH the value — the chip's appearance is a property of the vocabulary, not of
// a stylesheet somebody has to keep in sync with it.
//
// ===========================================================================
// EVERY SET HERE HAS A CHECK CONSTRAINT BEHIND IT
// ===========================================================================
// Not a convention — a rule. A vocabulary the database does not enforce is a
// vocabulary the database will eventually contradict, and then two surfaces
// disagree about what a row means. `MEMBER_ROLES` is
// `billing_workspace_members_role_check` and `INVITATION_STATUSES` is
// `billing_invitations_status_check`, both in migration 0001.
//
// Phase 1 added the sets that matter most — invoice status, reference type,
// audit action, rounding policy — each with its own CHECK in migration 0005 and
// each mirrored by a union in `types/index.ts`.
//
// **Three copies of one list is two too many, so they are checked against each
// other.** `lib/vocabularies.test.ts` reads this file, the migration and the
// type declarations and fails when they disagree. That test exists because of
// CLAUDE.md finding #18: a comment claimed a test asserted a scanner matched a
// migration's triggers, and no such test had ever been written.

/** One value in a closed set, with what a surface needs to render it. */
export interface Term {
  value: string
  label: string
  /** Hex, and it travels with the value so a new one needs no frontend release. */
  color?: string
  /** One sentence of consequence, where the value has one. Not a description. */
  note?: string
}

/**
 * A person's role in one of this app's workspaces.
 *
 * Two values, so `guide_test.go` does not count it — see the header. It is the
 * whole access model: `platform.workspace_apps` and `platform.app_access` were
 * dropped on 2026-08-10, so membership of a workspace IS permission to use this
 * app, and `owner` is the only thing above it.
 */
export const MEMBER_ROLES: Term[] = [
  {
    value: 'owner',
    label: 'Owner',
    color: '#0f6b44',
    note: 'Can invite, revoke and — from phase 1 — change a company’s IBAN, which redirects real money.',
  },
  { value: 'member', label: 'Member', color: '#5b6470' },
]

/**
 * The lifecycle of an invitation into one of this app's workspaces.
 *
 * ── `accepted` HAS HAD A WRITER SINCE PHASE 2 (2026-09-21) ──────────────────
 * `POST /api/invitations/accept` (`bk billing invite accept`, and the
 * `/invitations/{token}` page) writes it; a decline writes `revoked`. Before
 * phase 2 this value described a state the app could not reach, and was
 * declared anyway, for the same reason the CHECK constraint in 0001 permits it: the constraint and this list are one pair, and a value the
 * database allows and the vocabulary omits is how a row becomes unrenderable.
 * `expired` is the same case — nothing sweeps `expires_at` today.
 */
export const INVITATION_STATUSES: Term[] = [
  { value: 'pending', label: 'Pending', color: '#b8860b' },
  { value: 'accepted', label: 'Accepted', color: '#0f6b44' },
  { value: 'revoked', label: 'Revoked', color: '#8b1a1a' },
  { value: 'expired', label: 'Expired', color: '#5b6470' },
]

/**
 * The lifecycle of an invoice. **`draft → sent → paid`, anything → `void`, and
 * nothing else** — G3's trigger enforces the transitions, because a CHECK
 * cannot see the old row.
 *
 * `void` is not a fifth state to be tidied away. A voided invoice keeps its
 * number forever, carries the reason it was voided, and still renders. There is
 * no code path that frees a number, and adding one would be the bug.
 */
export const INVOICE_STATUSES: Term[] = [
  { value: 'draft', label: 'Draft', color: '#5b6470', note: 'Every field editable. Not a document yet.' },
  {
    value: 'sent',
    label: 'Sent',
    color: '#1d4ed8',
    note: 'The document half is frozen (G2). The payment message, the due date and the status stay open.',
  },
  { value: 'paid', label: 'Paid', color: '#0f6b44', note: 'An assertion by a person, never a reconciliation. Requires a paid date.' },
  {
    value: 'void',
    label: 'Void',
    color: '#8b1a1a',
    note: 'Cancelled with a reason. The number stays consumed; a correction is a void plus a reissue.',
  },
]

/**
 * The Swiss QR-bill reference type — and which one an invoice may use is not a
 * free choice.
 *
 * `docs/billing-app-plan/qr-bill.md` has the combination matrix. The half that
 * a CHECK can express is in G4; the half that needs the company row (QRR
 * requires the company to HAVE a QR-IBAN) is enforced at the write door.
 */
export const REFERENCE_TYPES: Term[] = [
  {
    value: 'QRR',
    label: 'QR reference',
    color: '#0f6b44',
    note: 'CHF only, and only on a QR-IBAN (IID 30000–31999). 26 digits plus a modulo-10 check digit.',
  },
  {
    value: 'SCOR',
    label: 'Creditor reference',
    color: '#1d4ed8',
    note: 'ISO 11649. CHF or EUR, on an ordinary IBAN. Up to 25 characters after the RF check digits.',
  },
  {
    value: 'NON',
    label: 'No reference',
    color: '#5b6470',
    note: 'No reference at all, so the body must be empty. The payment message carries what the payer needs.',
  },
]

/**
 * The DOCUMENT's language — what the invoice is written in, and which set of
 * Annex C literals the payment part prints.
 *
 * **Not the operator's UI language.** A French-speaking bookkeeper bills a
 * German-speaking client in German, and conflating the two would mean the
 * client's bill changes language depending on who opened the screen.
 */
export const DOCUMENT_LANGUAGES: Term[] = [
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'en', label: 'English' },
]

/**
 * How a company rounds — decision D-B7, and a per-company setting rather than
 * one platform constant.
 *
 * An earlier draft of the plan declared a single `VAT_ROUNDING_STEP`. The first
 * external customer rounds VAT to the rappen and only the payable total to five
 * rappen, while the mockup rounds every line and every VAT amount to five. Both
 * are correct bookkeeping; two companies in one workspace may keep different
 * books, so the value is DATA.
 *
 * `exact_0_05` was added on 2026-09-23 from a closer read of that customer's
 * code: they never round a line at all — qty × price stays exact, the sum is
 * exact, and the payable total is rounded ONCE. `total_0_05` rounds each line
 * to the rappen first, and on a fractional quantity the two land on different
 * totals. The lines are still PRINTED to the rappen and the `rounding` figure
 * makes the paper foot (`lib/derive/totals.ts`).
 *
 * **Changing a company's policy changes every total it has ever derived**,
 * because nothing is stored. That is the point of deriving them, and it is also
 * why this is a setting an owner changes deliberately rather than a default
 * somebody flips.
 */
export const ROUNDING_POLICIES: Term[] = [
  {
    value: 'line_0_05',
    label: 'Per line, 5 rappen',
    note: 'Each line total and each VAT amount to five rappen, so the printed sums add up exactly with no rounding line. The mockup\u2019s behaviour, and the default.',
  },
  {
    value: 'total_0_05',
    label: 'Total only, 5 rappen',
    note: 'Lines and VAT to the rappen, the payable total to five, and the difference printed as its own Arrondi line.',
  },
  {
    value: 'exact_0_05',
    label: 'Exact lines, total to 5 rappen',
    note:
      'Lines kept exact (never rounded), VAT taken on the exact base to the rappen, the payable total rounded ONCE to five rappen. ' +
      'Lines print to the rappen and the Arrondi line carries whatever separates the printed subtotal from the total. The first external customer\u2019s policy.',
  },
  {
    value: 'none',
    label: 'Rappen',
    note: 'No five-rappen rounding anywhere. For a company billed only by transfer, where no cash amount is ever tendered.',
  },
]

/**
 * What an audit row records. **The log IS the edit workflow** — there is no
 * separate history feature.
 *
 * Served by `/api/meta` because an outside system polling
 * `GET …/audit?since=<seq>` switches on these values, and a new one must not
 * need a release on their side to be understood.
 */
export const AUDIT_ACTIONS: Term[] = [
  { value: 'created', label: 'Created' },
  { value: 'field_changed', label: 'Field changed', note: 'Carries the field path, the old value and the new one.' },
  { value: 'status_changed', label: 'Status changed' },
  {
    value: 'sent',
    label: 'Sent',
    note:
      'Emailed by this app: names the recipients and the message id. Marked sent outside ' +
      'this app: says so, and carries no message id.',
  },
  { value: 'paid', label: 'Marked paid' },
  { value: 'voided', label: 'Voided', note: 'Carries the reason, in both languages.' },
]

/**
 * How a write arrived. The ONLY structural difference between a human write and
 * an agent write, which is why both land in one log rather than two.
 *
 * Same spelling as `/api/meta`'s `user.via`, deliberately: an agent correlating
 * the two should not have to learn a second vocabulary for one fact.
 */
export const ACTOR_VIA: Term[] = [
  { value: 'session', label: 'Browser' },
  { value: 'token', label: 'Token' },
]

/**
 * Where an imported bill came from (phase 5). Two systems, both being retired.
 *
 * A new source is a CHECK change in a migration AND a line here — the pair is
 * what `lib/vocabularies.test.ts` checks. Two values, so `guide_test.go` does not
 * count it; it is still one list in one place.
 */
export const HISTORY_SOURCES: Term[] = [
  { value: 'zoho', label: 'Zoho Books', color: '#1d4ed8' },
  { value: 'invoicely', label: 'Invoicely', color: '#6d28d9' },
]

/**
 * An imported bill's status, as its source recorded it, mapped onto three words.
 *
 * **Deliberately not the native lifecycle.** There is no `draft` (an archive
 * holds what was issued) and no `sent`: a source's "sent", "overdue" or
 * "partially paid" is `unpaid` here, and anything the three words lose — a
 * partial payment, a void with no reason — goes in the import flag, in words.
 *
 * **An `unpaid` archived bill is not a receivable in this app.** Nothing sums
 * it into the overview and nothing chases it: that is b/books' question, and
 * mixing the archive into live receivables would make the dashboard's numbers
 * depend on a seven-year-old export.
 */
export const HISTORY_STATUSES: Term[] = [
  { value: 'paid', label: 'Paid', color: '#0f6b44' },
  {
    value: 'unpaid',
    label: 'Unpaid',
    color: '#b8860b',
    note: 'As the source recorded it. Not a receivable here — the archive is never summed into the overview.',
  },
  { value: 'void', label: 'Void', color: '#8b1a1a', note: 'Cancelled in the source. A missing reason is in the import flag.' },
]

/**
 * How often a series repeats (phase 4). Each has its own period shape —
 * `2026-10`, `2026-Q4`, `2026` — in `lib/derive/recurrence.ts`.
 */
export const RECURRENCE_FREQUENCIES: Term[] = [
  { value: 'monthly', label: 'Monthly', note: 'Period like 2026-10. A start on the 31st falls on each month’s last day where it is shorter.' },
  { value: 'quarterly', label: 'Quarterly', note: 'Period like 2026-Q4.' },
  { value: 'yearly', label: 'Yearly', note: 'Period like 2026.' },
]

/**
 * Where a series stands. **`completed` is never set by hand**: it is what a
 * series becomes when its counter reaches its cap, and a CHECK in 0012 holds the
 * two together (invariant I9). There is no open-ended series to leave running.
 */
export const RECURRENCE_STATUSES: Term[] = [
  { value: 'active', label: 'Active', color: '#0f6b44', note: 'Generates when asked. Nothing generates on its own — an agent reads the next date.' },
  { value: 'paused', label: 'Paused', color: '#b8860b', note: 'Refuses to generate until resumed. Needs no reason.' },
  {
    value: 'completed',
    label: 'Completed',
    color: '#5b6470',
    note: 'Reached its cap. Set by the last generation, never by hand, and final.',
  },
]
