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
// **Phase 1 adds the sets that matter most** — invoice status, reference type,
// audit action, rounding policy — each with its own CHECK in migration 0005.
// Adding one here without the constraint is the half of the pair that fails
// silently.

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
 * ── `accepted` HAS NO WRITER YET, AND THAT IS STATED RATHER THAN HIDDEN ─────
 * `Invites` is on in the CLI (`send`, `list`, `revoke`) and `InviteAccept` is
 * off, because no accept route is mounted. So an invitation can be created and
 * not yet redeemed, and this value describes a state the app cannot currently
 * reach.
 *
 * It is declared anyway, for the same reason the CHECK constraint in 0001
 * permits it: the constraint and this list are one pair, and a value the
 * database allows and the vocabulary omits is how a row becomes unrenderable.
 * `expired` is the same case — nothing sweeps `expires_at` today.
 */
export const INVITATION_STATUSES: Term[] = [
  { value: 'pending', label: 'Pending', color: '#b8860b' },
  { value: 'accepted', label: 'Accepted', color: '#0f6b44' },
  { value: 'revoked', label: 'Revoked', color: '#8b1a1a' },
  { value: 'expired', label: 'Expired', color: '#5b6470' },
]
