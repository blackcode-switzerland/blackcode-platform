#!/usr/bin/env tsx
/**
 * Dev fixtures for b/sales — the mockup's data, as real rows.
 *
 * Derived from `bsales-mockup/assets/js/data.js`, English only (§2: the
 * mockup's `lang.js` does not port). It exists so that Phases 6–8 have something
 * real to render, and so that anyone can see the shape of the app without
 * inventing seven companies.
 *
 * ---------------------------------------------------------------------------
 * TWO GATES, AND BOTH ARE REQUIRED
 * ---------------------------------------------------------------------------
 *     NODE_ENV !== 'production'    AND    SALES_SEED=1
 *
 * Two rather than one, deliberately. `NODE_ENV` is set by whatever runs the
 * process and is easy to get wrong in a shell; `SALES_SEED` is a thing nobody
 * sets by accident. This script INSERTS SEVEN COMPANIES AND THIRTY-ODD CHILD
 * ROWS into whatever `DATABASE_URL` points at, and the failure mode of a single
 * gate is real customer data sitting next to "StaffUp".
 *
 * It is idempotent per workspace: every insert is keyed on
 * (workspace_id, name/title) and re-running updates rather than duplicates. It
 * never deletes anything it did not create.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 * - No uploads, and therefore no blob URLs. The mockup's documents are Drive
 *   references; seeding a `upload_url` pointing at a blob that does not exist
 *   would put a row in `platform.blob_references` for a file nobody can fetch,
 *   and `bk super-admin blob-drift` would report it forever. Every seeded
 *   document is an `external_url`.
 * - No `sales.events`. Those are written by the real write paths, inside the
 *   transaction that writes the source row. Seeding them here would be a SECOND
 *   implementation of the event spine, and the two would disagree the first
 *   time either changed.
 *
 *   **Since Phase 3 there is nothing to project.** This app no longer writes
 *   `platform.entities`, so `db:reproject` and its "run entity-drift --repair"
 *   predecessor are both gone with it — seeded rows are reachable through
 *   `bk sales …` and this app's own search, and they are not in the cross-app
 *   index because that index is now issues' alone.
 *
 * Usage:  SALES_SEED=1 npm run db:seed --workspace=sales
 */
import { config } from 'dotenv'
import { sql } from 'drizzle-orm'
import { mintToken } from '@blackcode/platform-auth'
import { getDb } from '@/lib/db/client'
import { APP_SLUG } from '@/lib/app'

/** The dev token's name. Read `mintDevToken`'s comment before changing it. */
const DEV_TOKEN_NAME = 'Companion'

/** Where `next dev` serves this app. Override with SALES_BASE_URL. */
const DEV_BASE_URL = 'http://localhost:3100'

config({ path: '.env.local' })
config({ path: '.env' })

// ---------------------------------------------------------------------------
// THE GATES
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV === 'production') {
  console.error('✗ refusing to seed: NODE_ENV=production')
  process.exit(1)
}
if (process.env.SALES_SEED !== '1') {
  console.error(
    '✗ refusing to seed: SALES_SEED is not set to 1.\n' +
      '  This writes seven companies and their history into whatever DATABASE_URL\n' +
      '  points at. Two gates, on purpose. Run:\n' +
      '    SALES_SEED=1 npm run db:seed --workspace=sales'
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// THE MOCKUP, AS DATA
// ---------------------------------------------------------------------------
// Dates are anchored to the mockup's "today" (Monday 27 July 2026) so the
// relative language in the notes still reads correctly against the stored
// timestamps. `next_action_due_label` keeps the mockup's phrasing verbatim —
// which is the whole reason that column exists.
const TODAY = new Date('2026-07-27T09:00:00Z')
const day = (offset: number, hhmm = '09:00') =>
  new Date(new Date(TODAY.getTime() + offset * 86_400_000).toISOString().slice(0, 10) + `T${hhmm}:00Z`)
const iso = (d: Date) => d.toISOString()

/**
 * A `text[]` parameter.
 *
 * Interpolating a JS array into a drizzle `sql` template produces `$1, $2, $3` —
 * a comma-separated LIST, which is right for `IN (…)` and wrong here: Postgres
 * reads it as a record and refuses with "column is of type text[] but expression
 * is of type record". `ARRAY[$1, $2, $3]::text[]` is the same values, still fully
 * parameterised, in the shape the column wants.
 */
const arr = (xs: readonly string[]) =>
  xs.length
    ? sql`ARRAY[${sql.join(xs.map((x) => sql`${x}`), sql`, `)}]::text[]`
    : sql`ARRAY[]::text[]`

interface SeedProspect {
  name: string
  city: string
  sector: string
  stage: string
  value: number
  source?: string
  summary?: string
  nextAction?: { type: string; due?: Date; dueLabel: string; note: string; owner: string }
  closedAt?: Date
  closedReason?: string
  contacts: Array<{ name: string; role: string; primary?: boolean }>
  journey: Array<{ stage: string; status: string; at?: Date; by?: string; note?: string }>
  objections: Array<{ type: string; raisedBy: string; raisedAt: Date; status: string; spoken: string; realFear: string; counter: string }>
  meetings: Array<{ at: Date; type: string; status: string; title: string; attendees: string[]; agenda?: string; outcome?: string }>
  comms: Array<{ channel: string; direction: string; at: Date; by: string; subject?: string; body: string }>
}

const PROSPECTS: SeedProspect[] = [
  {
    name: 'StaffUp',
    city: 'Lausanne',
    sector: 'SaaS · staffing',
    stage: 'negotiation',
    value: 24000,
    summary:
      'Phase 2 offer review (agents + integrations) on video. Julien sold on substance, stuck on the Q3 budget.',
    nextAction: {
      type: 'wait',
      due: day(4),
      dueLabel: 'This week',
      note: 'Two-milestone follow-up (12k + 12k) sent this morning by Companion. No reply from Julien by Thursday → reminder scheduled.',
      owner: 'Companion',
    },
    contacts: [
      { name: 'Julien Vasey', role: 'Co-founder · product', primary: true },
      { name: 'Salomé Weiss', role: 'Operations' },
    ],
    journey: [
      { stage: 'new_lead', status: 'done', at: day(-45), by: 'Andrea', note: 'Phase 1 (platform) shipped — Phase 2 file opened.' },
      { stage: 'contacted', status: 'done', at: day(-41), by: 'Companion', note: 'Phase 2 proposal sent (agents + integrations).' },
      { stage: 'meeting', status: 'done', at: day(-33), by: 'Andrea', note: 'Agent demo on video. Julien + Salomé in the room.' },
      { stage: 'negotiation', status: 'current', at: day(-7), by: 'Andrea', note: 'Q3 budget objection — two-milestone counter in flight.' },
      { stage: 'won', status: 'upcoming' },
    ],
    objections: [
      {
        type: 'pricing',
        raisedBy: 'Julien Vasey',
        raisedAt: day(-2),
        status: 'open',
        spoken: '"24k for phase 2 is above our Q3 budget."',
        realFear: 'Fear of committing before their next raise.',
        counter: 'Split into two milestones: 12k now, 12k at go-live — risk tracks value.',
      },
    ],
    meetings: [
      { at: day(-2, '18:00'), type: 'video', status: 'done', title: 'Phase 2 offer review', attendees: ['Andrea', 'Julien Vasey', 'Salomé Weiss'], outcome: "Julien sold on substance, stuck on Q3 budget. Two-milestone counter decided. Logged by Companion from Andrea's voice debrief." },
      { at: day(-33, '11:00'), type: 'video', status: 'done', title: 'Agent demo', attendees: ['Andrea', 'Julien Vasey', 'Salomé Weiss'], outcome: 'Strong signal. Salomé wants the agents for her ops team — marked as ally.' },
    ],
    comms: [
      { channel: 'email', direction: 'out', at: day(0, '09:12'), by: 'Companion · auto-logged', subject: 'Re: Phase 2 — two-milestone proposal', body: 'Two-milestone follow-up sent to Julien Vasey after your approval. Open-tracking active.' },
      { channel: 'call', direction: 'out', at: day(-2, '18:40'), by: 'Andrea · voice debrief', body: 'Video call, 40 min. Julien sold on substance, stuck on Q3 budget. Salomé wants the agents for her ops team.' },
      { channel: 'whatsapp', direction: 'in', at: day(-3, '16:00'), by: 'Companion · auto-logged', body: 'Julien: "We\'re looking at the budget this week, come back to me Monday."' },
      { channel: 'email', direction: 'in', at: day(-32, '10:00'), by: 'Companion · auto-logged', subject: 'Re: Phase 2 proposal — ATS integration questions', body: "Salomé's feedback on the proposal: questions about the ATS integration." },
      { channel: 'email', direction: 'out', at: day(-41, '10:00'), by: 'Companion · auto-logged', subject: 'Phase 2 proposal — agents & integrations', body: 'Phase 2 proposal sent (agents + integrations).' },
    ],
  },
  {
    name: 'Metaesthetics',
    city: 'Genève',
    sector: 'Medical-aesthetics platform',
    stage: 'meeting',
    value: 36000,
    source: 'referral',
    summary: 'Pilote Terrain mockup presented. Very well received — wants a V2 with the mystery-shopper flow before deciding.',
    nextAction: { type: 'demo', due: day(3, '10:00'), dueLabel: 'Thu 30 July, 10:00', note: 'V2 demo on video. Companion preps the brief + run of show.', owner: 'Andrea' },
    contacts: [{ name: 'Kevin Loisel', role: 'Sponsor · SKS Innovation SA', primary: true }],
    journey: [
      { stage: 'new_lead', status: 'done', at: day(-25), by: 'Andrea', note: 'Introduced via Kevin Loisel (SKS Innovation).' },
      { stage: 'contacted', status: 'done', at: day(-19), by: 'Companion', note: 'Pilote Terrain deck sent + demo slot proposed.' },
      { stage: 'meeting', status: 'current', at: day(-5), by: 'Andrea', note: 'Mockup presented in person. V2 requested before decision.' },
      { stage: 'negotiation', status: 'upcoming' },
      { stage: 'won', status: 'upcoming' },
    ],
    objections: [],
    meetings: [
      { at: day(3, '10:00'), type: 'video', status: 'upcoming', title: 'V2 demo · Pilote Terrain', attendees: ['Andrea', 'Kevin Loisel'], agenda: 'Pilot recap (5 min), mystery-shopper flow + Pro offer (15 min), questions (10 min). Kevin will want numbers — conversion projection ready.' },
      { at: day(-5, '16:00'), type: 'in_person', status: 'done', title: 'Mockup presentation', attendees: ['Andrea', 'Kevin Loisel'], outcome: "Very well received. V2 requested before deciding — stage moved to 'Demo / Meeting'." },
    ],
    comms: [
      { channel: 'whatsapp', direction: 'out', at: day(-3, '16:05'), by: 'Companion · auto-logged', body: 'V2 mockup link sent to Kevin + Thursday 10:00 slot confirmed.' },
      { channel: 'call', direction: 'out', at: day(-5, '17:30'), by: 'Andrea · voice debrief', body: 'Mockup presented in person. Very well received, V2 requested before deciding.' },
      { channel: 'email', direction: 'out', at: day(-19, '10:00'), by: 'Companion · auto-logged', subject: 'Pilote Terrain — deck & demo slots', body: 'Pilote Terrain deck sent + demo slots proposed.' },
    ],
  },
  {
    name: 'YMERI Sàrl',
    city: 'Renens',
    sector: 'Construction · renovation',
    stage: 'won',
    value: 9500,
    closedAt: day(-7),
    closedReason: 'Kickoff signed: website + quote automation. First milestone invoiced.',
    summary: 'Kickoff signed: website + quote automation. First milestone invoiced.',
    nextAction: { type: 'check_in', due: day(4, '09:00'), dueLabel: 'Fri 31 July', note: 'Weekly progress check-in. Companion sends the recap beforehand.', owner: 'Companion' },
    contacts: [{ name: 'Besnik Ymeri', role: 'Owner-manager', primary: true }],
    journey: [
      { stage: 'new_lead', status: 'done', at: day(-60), by: 'Kali', note: 'Field lead, Renens.' },
      { stage: 'contacted', status: 'done', at: day(-50), by: 'Companion' },
      { stage: 'meeting', status: 'done', at: day(-30), by: 'Andrea' },
      { stage: 'negotiation', status: 'done', at: day(-14), by: 'Andrea' },
      { stage: 'won', status: 'current', at: day(-7), by: 'Andrea', note: 'Scope confirmed: website + quote automation. First milestone invoiced.' },
    ],
    objections: [],
    meetings: [
      { at: day(4, '09:00'), type: 'call', status: 'upcoming', title: 'Weekly check-in', attendees: ['Andrea', 'Besnik Ymeri'], agenda: 'Milestone 1 progress. Companion sends the recap the evening before.' },
      { at: day(-7, '10:00'), type: 'in_person', status: 'done', title: 'Project kickoff', attendees: ['Andrea', 'Besnik Ymeri'], outcome: 'Scope confirmed: website + quote automation. First milestone invoiced.' },
    ],
    comms: [
      { channel: 'whatsapp', direction: 'out', at: day(-6, '11:00'), by: 'Companion · auto-logged', body: 'Kickoff recap + milestone calendar sent to Besnik.' },
      { channel: 'call', direction: 'out', at: day(-7, '11:30'), by: 'Andrea · voice debrief', body: 'Kickoff in person. Scope confirmed: website + quote automation.' },
    ],
  },
  {
    name: 'SKS Innovation SA',
    city: 'Lausanne',
    sector: 'Innovation consultancy',
    stage: 'new_lead',
    value: 18000,
    source: 'referral',
    nextAction: { type: 'email', due: day(0), dueLabel: 'Today', note: 'Intro email drafted by Companion (Metaesthetics reference). Send scheduled today.', owner: 'Companion' },
    contacts: [{ name: 'Kevin Loisel', role: 'Principal', primary: true }],
    journey: [
      { stage: 'new_lead', status: 'current', at: day(-1), by: 'Companion', note: 'Referred by the Metaesthetics engagement.' },
      { stage: 'contacted', status: 'upcoming' },
    ],
    objections: [],
    meetings: [],
    comms: [],
  },
  {
    name: 'Fiduciaire Roches SA',
    city: 'Morges',
    sector: 'Accounting firm',
    stage: 'contacted',
    value: 15000,
    summary: 'Follow-up email sent by Companion. Polite but cautious reply: they already run Abacus.',
    nextAction: { type: 'call', due: day(2, '14:30'), dueLabel: 'Wed 29 July', note: "Qualification call. Angle: we don't replace Abacus, we automate what it doesn't do.", owner: 'Andrea' },
    contacts: [{ name: 'Pascal Roches', role: 'Partner', primary: true }],
    journey: [
      { stage: 'new_lead', status: 'done', at: day(-14), by: 'Companion' },
      { stage: 'contacted', status: 'current', at: day(-6), by: 'Companion', note: 'Follow-up email sent; polite but cautious reply.' },
      { stage: 'meeting', status: 'upcoming' },
    ],
    objections: [
      {
        type: 'existing_solution',
        raisedBy: 'Pascal Roches',
        raisedAt: day(-6),
        status: 'open',
        spoken: '"We already have Abacus, why change?"',
        realFear: 'Fear of an IT project bleeding into tax season.',
        counter: "We don't touch Abacus. We automate around it: reminders, data entry, reconciliation. Zero migration.",
      },
    ],
    meetings: [
      { at: day(2, '14:30'), type: 'call', status: 'upcoming', title: 'Qualification call', attendees: ['Andrea', 'Pascal Roches'], agenda: "Angle: we don't replace Abacus, we automate around it (reminders, data entry, reconciliation). Zero migration." },
    ],
    comms: [
      { channel: 'email', direction: 'in', at: day(-5, '09:00'), by: 'Companion · auto-logged', subject: 'Re: Automating around Abacus', body: 'Reply from Pascal Roches: polite but cautious — "We already have Abacus, why change?"' },
      { channel: 'email', direction: 'out', at: day(-6, '09:00'), by: 'Companion · auto-logged', subject: 'Automating around Abacus — no migration', body: 'Follow-up email: "automate around Abacus, don\'t replace it" angle.' },
    ],
  },
  {
    name: 'Atelier Brandt Architectes',
    city: 'Vevey',
    sector: 'Architecture',
    stage: 'new_lead',
    value: 12000,
    source: 'word of mouth',
    nextAction: { type: 'email', due: day(4), dueLabel: 'This week', note: 'First outreach to draft — angle: site tracking + invoicing.', owner: 'Companion' },
    contacts: [{ name: 'Claire Brandt', role: 'Founder', primary: true }],
    journey: [
      { stage: 'new_lead', status: 'current', at: day(-3), by: 'Companion', note: 'Found in the "architecture studios, Riviera" sweep. Record created.' },
      { stage: 'contacted', status: 'upcoming' },
    ],
    objections: [],
    meetings: [],
    comms: [
      { channel: 'discovery', direction: 'out', at: day(-3, '11:20'), by: 'Companion · auto-logged', body: 'Prospect identified via Google Maps (architecture studios, Riviera). Record created.' },
    ],
  },
  {
    name: 'Clinique Altura',
    city: 'Montreux',
    sector: 'Private clinic',
    stage: 'lost',
    value: 20000,
    closedAt: day(-21),
    closedReason: 'Went with an off-the-shelf SaaS (Pipedrive). Door open for custom work in 12 months.',
    summary: 'Went with an off-the-shelf SaaS (Pipedrive). Door open for custom work in 12 months.',
    contacts: [{ name: 'Dr. Elena Rossi', role: 'Director', primary: true }],
    journey: [
      { stage: 'new_lead', status: 'done', at: day(-70), by: 'Kali' },
      { stage: 'contacted', status: 'done', at: day(-60), by: 'Companion' },
      { stage: 'meeting', status: 'done', at: day(-40), by: 'Andrea' },
      { stage: 'lost', status: 'current', at: day(-21), by: 'Andrea', note: 'Polite pass: chose an off-the-shelf SaaS.' },
    ],
    objections: [
      { type: 'timing', raisedBy: 'Dr. Elena Rossi', raisedAt: day(-25), status: 'countered', spoken: 'IT budget frozen until 2027.', realFear: 'A custom build with no internal owner.', counter: 'Offered a fixed-scope pilot instead of a programme. Not enough.' },
    ],
    meetings: [
      { at: day(-21, '15:00'), type: 'video', status: 'cancelled', title: 'Custom demo', attendees: ['Andrea', 'Dr. Elena Rossi'], outcome: 'Cancelled by the clinic — went with an off-the-shelf SaaS. Door open in 12 months.' },
    ],
    comms: [
      { channel: 'email', direction: 'in', at: day(-21, '14:00'), by: 'Companion · auto-logged', subject: 'Re: Custom demo — our decision', body: 'Polite pass: went with an off-the-shelf SaaS. Door open in 12 months.' },
    ],
  },
]

const PRODUCTS = [
  { category: 'module', name: 'Agents & integrations (Phase 2)', priceLabel: 'CHF 24,000 · project', from: 24000, to: 24000, description: 'Operational agents wired into an existing product: task execution, third-party integrations, transaction log. The model sold to StaffUp.', fit: ['SaaS with an ops team', 'existing product'], pitch: 'Agents do the repetitive work inside YOUR product — not yet another tool on the side.', refs: ['StaffUp'] },
  { category: 'module', name: 'Custom Trinity module', priceLabel: 'from CHF 12,000', from: 12000, to: null, description: 'An agentic module built on the payroll pattern: CLI + SQLite + read-only dashboard, undo, transaction log, automatic backups.', fit: ['SMB < 20 employees', 'manual ops around an incumbent tool'], pitch: "We don't replace your tool — we automate around it. Zero migration.", refs: ['Fiduciaire Roches SA', 'SKS Innovation SA'] },
  { category: 'service', name: 'Website + quote automation', priceLabel: 'CHF 8,000–15,000', from: 8000, to: 15000, description: 'Marketing site + automated quote funnel (follow-ups included). Shipped for YMERI; natural angle for construction trades and studios.', fit: ['construction trades', 'studios / workshops', 'frequent quoting'], pitch: 'Every quote that lingers is a lost job — the funnel follows up on its own.', refs: ['YMERI Sàrl', 'Atelier Brandt Architectes'] },
  { category: 'module', name: 'b/payroll', priceLabel: 'CHF 4,800 + CHF 190/mo', from: 4800, to: null, statusLabel: 'v1.3 · shipped internally', description: 'Payroll management: employees, rates, payments, CSV/PDF exports, undo and audit log. Proven internally at blackcode since May 2026.', fit: ['Swiss SMBs', 'payroll done by hand'], pitch: 'Payroll that runs in one command, with a log that stands up to an audit.', refs: [] },
  { category: 'licence', name: 'Pilote Terrain (JV)', priceLabel: 'on request', from: null, to: null, description: 'The field tool built for Metaesthetics: routes, voice debrief, demo mode, supervision. Licensable to other field-sales motions.', fit: ['field / door-to-door sales', 'rep teams'], pitch: 'The rep talks, the agent writes — the field flows into the pipeline by itself.', refs: ['Metaesthetics'] },
  { category: 'service', name: 'Agentic ops retainer', priceLabel: 'CHF 1,500/mo', from: 1500, to: 1500, description: 'Ongoing maintenance + small automations on shipped modules. The natural follow-on after a project.', fit: ['existing clients', 'post-project'], pitch: 'The module lives, needs shift — someone owns it continuously.', refs: ['YMERI Sàrl'] },
]

const TEMPLATES = [
  { channel: 'email', category: 'intro', stage: 'new_lead', name: 'Intro · client reference', subject: 'A system like the one we shipped at {{reference}}', body: 'Hello {{firstName}},\n\nWe just shipped an agent system at {{reference}} that runs {{useCase}} end to end. Given {{prospectContext}}, a similar model could win you {{benefit}}.\n\n15 minutes this week to pressure-test it?' },
  { channel: 'email', category: 'follow_up', stage: 'meeting', name: 'Post-demo follow-up', subject: 'Three open points from {{day}}', body: 'Hello {{firstName}},\n\nThanks for your time on {{day}}. Three open points: {{point1}}, {{point2}}, {{point3}}.\n\nSuggested next step: {{nextStep}} — {{date}}?' },
  { channel: 'email', category: 'objection', stage: 'negotiation', name: 'Budget objection · milestone offer', subject: 'Re: budget — two milestones instead of one', body: 'Hello {{firstName}},\n\nI hear the budget constraint. Counter-proposal: split into two milestones — {{amount1}} at kickoff, {{amount2}} at go-live. Commitment tracks delivered value, not promises.\n\nTalk on {{date}}?' },
  { channel: 'whatsapp', category: 'meeting', stage: 'meeting', name: 'Meeting confirmation', body: 'Hi {{firstName}} 👋 Confirming our {{meetingType}} on {{day}} at {{time}}. Agenda: {{agenda}}. See you {{day}}!' },
  { channel: 'whatsapp', category: 'follow_up', stage: 'contacted', name: 'Soft follow-up', body: 'Hi {{firstName}}, circling back as agreed about {{topic}}. Still on your side of the table?' },
  { channel: 'call', category: 'intro', stage: 'contacted', name: 'Qualification call · incumbent tool', body: '1. Open on their current process, not on us.\n2. "What does {{incumbentTool}} NOT do for you today?"\n3. Position: we don\'t touch it — we automate around it (reminders, data entry, reconciliation). Zero migration.\n4. Price the status quo: hours/week lost.\n5. Close on a demo slot, not on sending a doc.' },
  { channel: 'call', category: 'objection', stage: 'negotiation', name: 'Price objection · talking points', body: "1. Don't defend the number — decompose the risk: milestones.\n2. Price the status quo (~1 ops day/week, manual).\n3. Reference: {{reference}} recouped the spend in {{duration}}.\n4. If stuck: shrink scope, never the unit price." },
  { channel: 'email', category: 'kickoff', stage: 'won', name: 'Won-deal kickoff', subject: 'Kickoff — scope, milestones and your contact', body: 'Hello {{firstName}},\n\nGlad to get started. Attached: validated scope, milestone calendar, and your point of contact. First progress check-in on {{date}}.\n\nBest,\nAndrea' },
]

// Every seeded document is an EXTERNAL link — see the header for why none of
// them is an upload.
const DOCUMENTS = [
  { title: 'blackcode company one-pager', kind: 'link', url: 'https://drive.google.com/file/d/bc-onepager', description: 'Company one-pager — attached to intro emails.', tags: ['intro', 'company'], by: 'Andrea' },
  { title: 'Agents Phase 2 — specification', kind: 'link', url: 'https://drive.google.com/file/d/spec-agents', description: 'Spec attached to the Phase 2 proposal.', tags: ['spec', 'agents'], by: 'Companion · auto' },
  { title: 'StaffUp — two-milestone offer', kind: 'link', url: 'https://drive.google.com/file/d/staffup-offre', description: 'PDF of the two-milestone counter-proposal, attached to the follow-up.', tags: ['offer', 'pricing'], by: 'Companion · auto' },
  { title: 'Pilote Terrain — presentation deck', kind: 'link', url: 'https://drive.google.com/file/d/pt-dossier', description: 'Presentation deck sent with the demo-slot proposal.', tags: ['pilote-terrain', 'presentation'], by: 'Companion · auto' },
  { title: 'Pilote Terrain V2 — demo recording', kind: 'video', url: 'https://drive.google.com/file/d/pt-demo-video', description: 'V2 demo screen capture — sent to Kevin on WhatsApp ahead of Thursday.', tags: ['pilote-terrain', 'demo'], by: 'Kali · field' },
  { title: 'Abacus automation diagram', kind: 'image', url: 'https://drive.google.com/file/d/abacus-schema', description: '"Automate around Abacus" diagram — support for Wednesday\'s call.', tags: ['diagram', 'accounting'], by: 'Companion · auto' },
  { title: 'Case study — YMERI (automated quotes)', kind: 'deck', url: 'https://drive.google.com/file/d/case-ymeri', description: 'Numbers-backed reference: YMERI quote funnel, milestones, results. Attach to construction-trade intros.', tags: ['case-study', 'reference'], by: 'Andrea' },
  { title: 'b/payroll — video walkthrough (Loom)', kind: 'link', url: 'https://loom.com/share/bpayroll-v13-tour', description: 'Full 6-minute tour of b/payroll v1.3 — the demo link to send before a first call.', tags: ['payroll', 'demo'], by: 'Andrea' },
  { title: 'blackcode pricing sheet 2026', kind: 'link', url: 'https://drive.google.com/file/d/pricing-2026', description: 'Internal pricing sheet, all products. Internal use — do not send as-is.', tags: ['pricing', 'internal'], by: 'Andrea' },
  { title: 'Drive — "Sales collateral" folder', kind: 'link', url: 'https://drive.google.com/drive/folders/sales-collateral', description: 'Drive root where the real files live.', tags: ['drive', 'root'], by: 'Andrea' },
]

// prospect name → [product name, fit, why]
const MATCHES: Array<[string, string, number, string]> = [
  ['StaffUp', 'Agents & integrations (Phase 2)', 87, 'Phase 2 already scoped — budget objection being worked.'],
  ['Metaesthetics', 'Pilote Terrain (JV)', 92, 'Pilot presented, V2 demo Thursday.'],
  ['Fiduciaire Roches SA', 'Custom Trinity module', 74, 'Automate around Abacus: reminders, data entry, reconciliation.'],
  ['SKS Innovation SA', 'Custom Trinity module', 66, 'Same agentic stack as the Metaesthetics pilot, applied to their mandates.'],
  ['Atelier Brandt Architectes', 'Website + quote automation', 71, 'Site tracking + invoicing — direct YMERI analogy.'],
  ['YMERI Sàrl', 'Agentic ops retainer', 80, 'After milestone 2: ongoing maintenance + automations.'],
]

// ---------------------------------------------------------------------------
async function main() {
  const db = getDb()

  // `sales.workspaces`, not `platform.workspaces` (Phase 2). Every table below
  // has a foreign key on the former, so seeding a platform workspace id that
  // this app does not know about fails on the first insert — and, for the ids
  // the two tables still share, would seed into a workspace whose membership is
  // a different set of people.
  const wsRes = await db.execute(sql`SELECT id, slug, name FROM sales.workspaces ORDER BY id LIMIT 1`)
  const ws = wsRes.rows[0]
  if (!ws) {
    console.error(
      '✗ no workspace in sales.workspaces — sign up at this app (POST /api/auth/register) ' +
        'or sign in once; the first sign-in mints one.'
    )
    process.exit(1)
  }
  const wsId = Number(ws.id)
  console.log(`▶ seeding sales fixtures into workspace "${ws.slug}" (id ${wsId})`)

  // One transaction. A half-seeded database is worse than none — the child rows
  // reference prospects by name, so a partial run leaves dangling intent.
  await db.transaction(async (tx) => {
    const next = async (type: string) =>
      Number(
        (
          await tx.execute(sql`
            INSERT INTO sales.counters (workspace_id, entity_type, last_seq) VALUES (${wsId}, ${type}, 1)
            ON CONFLICT (workspace_id, entity_type) DO UPDATE SET last_seq = sales.counters.last_seq + 1
            RETURNING last_seq`)
        ).rows[0].last_seq
      )

    // ── products ──────────────────────────────────────────────────────────
    const productId = new Map<string, number>()
    for (const p of PRODUCTS) {
      const existing = (await tx.execute(sql`SELECT id FROM sales.products WHERE workspace_id=${wsId} AND name=${p.name}`)).rows[0]
      const id = existing
        ? Number(existing.id)
        : Number(
            (
              await tx.execute(sql`
                INSERT INTO sales.products (workspace_id, seq, category, name, price_label, price_from, price_to, description, fit, pitch, status_label, refs)
                VALUES (${wsId}, ${await next('product')}, ${p.category}, ${p.name}, ${p.priceLabel}, ${p.from}, ${p.to},
                        ${p.description}, ${arr(p.fit)}, ${p.pitch}, ${p.statusLabel ?? null}, ${arr(p.refs)})
                RETURNING id`)
            ).rows[0].id
          )
      productId.set(p.name, id)
    }

    // ── templates ─────────────────────────────────────────────────────────
    for (const t of TEMPLATES) {
      const existing = (await tx.execute(sql`SELECT id FROM sales.templates WHERE workspace_id=${wsId} AND name=${t.name}`)).rows[0]
      if (existing) continue
      // `variables` is parsed from the body on write — the same rule the real
      // write path follows, so the fixture cannot disagree with production.
      const vars = [...new Set([...(t.body.match(/\{\{(\w+)\}\}/g) ?? [])].map((m) => m.slice(2, -2)))]
      await tx.execute(sql`
        INSERT INTO sales.templates (workspace_id, seq, channel, category, stage, name, subject, body, variables)
        VALUES (${wsId}, ${await next('template')}, ${t.channel}, ${t.category}, ${t.stage}, ${t.name}, ${t.subject ?? null}, ${t.body}, ${arr(vars)})`)
    }

    // ── documents ─────────────────────────────────────────────────────────
    for (const d of DOCUMENTS) {
      const existing = (await tx.execute(sql`SELECT id FROM sales.documents WHERE workspace_id=${wsId} AND title=${d.title}`)).rows[0]
      if (existing) continue
      await tx.execute(sql`
        INSERT INTO sales.documents (workspace_id, seq, title, kind, external_url, description, tags, added_by_label)
        VALUES (${wsId}, ${await next('document')}, ${d.title}, ${d.kind}, ${d.url}, ${d.description}, ${arr(d.tags)}, ${d.by})`)
    }

    // ── prospects and their children ──────────────────────────────────────
    const prospectId = new Map<string, number>()
    for (const p of PROSPECTS) {
      const existing = (await tx.execute(sql`SELECT id FROM sales.prospects WHERE workspace_id=${wsId} AND name=${p.name}`)).rows[0]
      if (existing) {
        prospectId.set(p.name, Number(existing.id))
        continue
      }
      const id = Number(
        (
          await tx.execute(sql`
            INSERT INTO sales.prospects
              (workspace_id, seq, name, city, sector, stage, value, source, summary,
               next_action_type, next_action_due, next_action_due_label, next_action_note, next_action_owner_label,
               closed_at, closed_reason)
            VALUES (${wsId}, ${await next('prospect')}, ${p.name}, ${p.city}, ${p.sector}, ${p.stage}, ${p.value},
                    ${p.source ?? null}, ${p.summary ?? null},
                    ${p.nextAction?.type ?? null}, ${p.nextAction?.due ? iso(p.nextAction.due).slice(0, 10) : null},
                    ${p.nextAction?.dueLabel ?? null}, ${p.nextAction?.note ?? null}, ${p.nextAction?.owner ?? null},
                    ${p.closedAt ? iso(p.closedAt) : null}, ${p.closedReason ?? null})
            RETURNING id`)
        ).rows[0].id
      )
      prospectId.set(p.name, id)

      const contactId = new Map<string, number>()
      for (const c of p.contacts) {
        const cid = Number(
          (
            await tx.execute(sql`
              INSERT INTO sales.contacts (workspace_id, prospect_id, name, role, is_primary)
              VALUES (${wsId}, ${id}, ${c.name}, ${c.role}, ${c.primary ?? false}) RETURNING id`)
          ).rows[0].id
        )
        contactId.set(c.name, cid)
      }
      for (const j of p.journey) {
        await tx.execute(sql`
          INSERT INTO sales.stage_entries (workspace_id, prospect_id, stage, status, occurred_at, actor_label, note)
          VALUES (${wsId}, ${id}, ${j.stage}, ${j.status}, ${j.at ? iso(j.at) : null}, ${j.by ?? null}, ${j.note ?? null})`)
      }
      for (const o of p.objections) {
        await tx.execute(sql`
          INSERT INTO sales.objections (workspace_id, prospect_id, type, raised_by, raised_at, status, spoken, real_fear, counter)
          VALUES (${wsId}, ${id}, ${o.type}, ${o.raisedBy}, ${iso(o.raisedAt)}, ${o.status}, ${o.spoken}, ${o.realFear}, ${o.counter})`)
      }
      for (const m of p.meetings) {
        await tx.execute(sql`
          INSERT INTO sales.meetings (workspace_id, seq, prospect_id, starts_at, type, status, title, attendees, agenda, outcome)
          VALUES (${wsId}, ${await next('meeting')}, ${id}, ${iso(m.at)}, ${m.type}, ${m.status}, ${m.title}, ${arr(m.attendees)},
                  ${m.agenda ?? null}, ${m.outcome ?? null})`)
      }
      for (const c of p.comms) {
        await tx.execute(sql`
          INSERT INTO sales.communications (workspace_id, seq, prospect_id, channel, direction, occurred_at, subject, body, logged_by_label)
          VALUES (${wsId}, ${await next('communication')}, ${id}, ${c.channel}, ${c.direction}, ${iso(c.at)},
                  ${c.subject ?? null}, ${c.body}, ${c.by})`)
      }
    }

    // ── matches: the triangulation, STORED, as if the agent had written it ──
    for (const [pname, prodname, fit, why] of MATCHES) {
      const pid = prospectId.get(pname)
      const prid = productId.get(prodname)
      if (!pid || !prid) continue
      await tx.execute(sql`
        INSERT INTO sales.matches (workspace_id, prospect_id, product_id, fit, why, computed_by_label)
        VALUES (${wsId}, ${pid}, ${prid}, ${fit}, ${why}, 'Companion · seed')
        ON CONFLICT (prospect_id, product_id) DO UPDATE SET fit = EXCLUDED.fit, why = EXCLUDED.why`)
    }
  })

  const counts = await db.execute(sql`
    SELECT 'prospects' t, count(*)::int n FROM sales.prospects      WHERE workspace_id=${wsId}
    UNION ALL SELECT 'contacts',       count(*)::int FROM sales.contacts       WHERE workspace_id=${wsId}
    UNION ALL SELECT 'stage_entries',  count(*)::int FROM sales.stage_entries  WHERE workspace_id=${wsId}
    UNION ALL SELECT 'meetings',       count(*)::int FROM sales.meetings       WHERE workspace_id=${wsId}
    UNION ALL SELECT 'communications', count(*)::int FROM sales.communications WHERE workspace_id=${wsId}
    UNION ALL SELECT 'objections',     count(*)::int FROM sales.objections     WHERE workspace_id=${wsId}
    UNION ALL SELECT 'products',       count(*)::int FROM sales.products       WHERE workspace_id=${wsId}
    UNION ALL SELECT 'templates',      count(*)::int FROM sales.templates      WHERE workspace_id=${wsId}
    UNION ALL SELECT 'documents',      count(*)::int FROM sales.documents      WHERE workspace_id=${wsId}
    UNION ALL SELECT 'matches',        count(*)::int FROM sales.matches        WHERE workspace_id=${wsId}
    ORDER BY 1`)
  for (const r of counts.rows) console.log(`  ${String(r.t).padEnd(16)} ${r.n}`)
  console.log('✓ seeded. URNs are NOT projected — run `bk super-admin entity-drift --repair` if you want them.')

  // NO `enableAppForWorkspace` any more. `platform.workspace_apps` /
  // `platform.app_access` gate an app INSIDE a shared workspace, and this app
  // stopped consulting them in Phase 2 — a member of a sales workspace is a
  // sales user. Both tables are dropped in Phase 5. Writing them here would
  // also fail outright: their `workspace_id` has a foreign key on
  // `platform.workspaces`, and this workspace is `sales.workspaces`.
  await pointAppAtThisMachine(db)
  await mintDevToken(db, wsId)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// THE DEV ENVIRONMENT, NOT THE FIXTURES
// ---------------------------------------------------------------------------
// Seeded rows are useless if no command can reach them, and the two things
// standing between a fresh clone and `bk sales prospect list` are not data:
//
//   1. this app's `base_url` in `platform.apps`, or `bk sales …` is sent to
//      whatever the registry last recorded — production, from a laptop;
//   2. an API token, or there is nothing to authenticate with.
//
// (There used to be a third: a `platform.workspace_apps` row, without which
// every route answered 403 `app_access_denied`. Phase 2 stopped this app
// consulting that gate, and Phase 5 drops the tables.)
//
// Both live here rather than in a paragraph telling a developer to paste SQL.
// A hand-run `INSERT INTO platform.api_tokens` is not repeatable for the next
// person and is a bad habit to establish even locally — and pasted SQL is how a
// credential ends up in a shell history, a scrollback and a chat log.
//
// Both are behind the same two gates as the fixtures (NODE_ENV and SALES_SEED)
// and both are idempotent, like everything else in this file.

/**
 * Point this app's registry row at this machine.
 *
 * The URL comes from `SALES_BASE_URL` when set, and defaults to the port
 * `next dev` uses for this app. Behind the same two gates as everything else in
 * this file, because `base_url` is what every OTHER app's `bk sales …` resolves
 * to — pointing production at a laptop is the one mistake here that would be
 * visible to somebody else.
 */
async function pointAppAtThisMachine(db: ReturnType<typeof getDb>) {
  const url = process.env.SALES_BASE_URL ?? DEV_BASE_URL
  const before = await db.execute(sql`SELECT base_url FROM platform.apps WHERE slug = ${APP_SLUG}`)
  const previous = before.rows[0]?.base_url ?? null
  if (previous === url) {
    console.log(`▶ ${APP_SLUG} base_url is already ${url}`)
    return
  }
  await db.execute(sql`UPDATE platform.apps SET base_url = ${url} WHERE slug = ${APP_SLUG}`)
  console.log(
    `▶ ${APP_SLUG} base_url: ${previous ?? '(none)'} → ${url}\n` +
      "  `bk meta` reads this to learn where to send `bk sales …`, so it is what makes\n" +
      '  local routing survive the next refresh. Set SALES_BASE_URL to override.'
  )
}

/**
 * One local API token, named "Companion".
 *
 * THE NAME IS NOT DECORATION. `sales.stage_entries.actor_label` and its three
 * siblings are populated from the TOKEN'S name (docs/backend.md §3.4), because
 * an agent is not a `platform.users` row and agent-written history has to stay
 * visibly agent-written. Seeding a token called "dev" would make every journey
 * step in a local database say "dev", and the one behaviour worth seeing with
 * your own eyes would be invisible.
 *
 * Minted through `mintToken` — the same function `POST /api/tokens` uses — so
 * this file contains no hashing. A second implementation of credential minting
 * is a second chance to get it wrong, and it would be the one nobody reviews.
 *
 * IDEMPOTENT, AND THE HONEST KIND. A token's plaintext exists once, at mint,
 * and is not recoverable — so a second run cannot print the first run's token.
 * It says so, and names the one command that replaces it, rather than minting a
 * duplicate every run or pretending it did something.
 */
async function mintDevToken(db: ReturnType<typeof getDb>, wsId: number) {
  const ownerRes = await db.execute(sql`
    SELECT u.id, u.email
    FROM sales.workspaces w
    JOIN platform.users u ON u.id = w.owner_id
    WHERE w.id = ${wsId}`)
  const owner = ownerRes.rows[0]
  if (!owner) {
    console.log('▶ no owner on that workspace — skipping the dev token')
    return
  }

  const existing = await db.execute(sql`
    SELECT token_prefix FROM platform.api_tokens
    WHERE user_id = ${Number(owner.id)} AND name = ${DEV_TOKEN_NAME}
    LIMIT 1`)
  if (existing.rows[0]) {
    console.log(
      `▶ a token named "${DEV_TOKEN_NAME}" already exists for ${owner.email} ` +
        `(prefix ${existing.rows[0].token_prefix}…). Its plaintext existed once and is gone;\n` +
        '  to replace it: `bk token delete <id>` then re-run this seed.'
    )
    return
  }

  const token = await mintToken(db, {
    user_id: Number(owner.id),
    name: DEV_TOKEN_NAME,
    scopes: ['full'],
  })

  console.log(
    `\n▶ minted a local dev token for ${owner.email}, named "${DEV_TOKEN_NAME}".\n` +
      '  PRINTED ONCE — it is hashed in the database and cannot be shown again.\n\n' +
      `    ${token.plaintext}\n\n` +
      '  Point a bk config at this machine and use it:\n' +
      '    BK_CONFIG_DIR=/tmp/bk-dev bk login --server http://localhost:3000\n' +
      '  or write it into a config by hand. Every journey step you then write will\n' +
      `  be attributed to "${DEV_TOKEN_NAME}", which is the point of the name.`
  )
}

main().catch((e) => {
  console.error('✗ seed failed:', e)
  process.exit(1)
})
