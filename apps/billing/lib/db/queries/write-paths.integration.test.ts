// The write paths, against a real Postgres, as the app's own role.
//
//   TEST_DATABASE_URL=postgres://billing_app:…@localhost:5434/blackcode_issues \
//     npx vitest run lib/db/queries/write-paths.integration.test.ts
//
// Skipped — loudly — without it. `REQUIRE_INTEGRATION_TESTS=1` makes a missing
// database an error instead.
//
// ===========================================================================
// WHY THESE CANNOT BE UNIT TESTS
// ===========================================================================
// Every property below lives in the database or in the interaction between two
// transactions: a row lock that serialises the number allocator, a unique index
// that settles an idempotency race, an audit row written in the same
// transaction as its change. A mock of any of them would be a second
// implementation agreeing with itself. Tickets #75, #76 and #77 named these as
// proofs, and until 2026-09-17 none of them had been run.
//
// ── RUN IT AS `billing_app`, NOT AS THE OWNER ──────────────────────────────
// The owner bypasses the revokes, so a suite run as the owner can pass on a
// path the app itself cannot take. The URL above is the app's role.
//
// ── IT LEAVES ITS DATA BEHIND, AND SAYS SO ─────────────────────────────────
// Invoices are never deleted — by trigger and by revoke, for the owner too —
// so each run creates one workspace named `itest-<timestamp>` and leaves it.
// Nothing reads those workspaces; the seed rebuilds only its own. A test that
// could clean up after itself here would be a test proving the guard it
// exists to protect does not hold.
//
// ===========================================================================
// WATCHED FAILING, 2026-09-17 — each restored
// ===========================================================================
//   #75  the company number read as MAX(seq_no)+1 OUTSIDE the transaction (the
//        ticket's mutation) → 19 of the 20 creates refused with
//        `duplicate key … uq_invoice_company_seq_no`: the duplicate, produced,
//        and caught by the backstop index
//   #75  the same read INSIDE the transaction, without the company row lock →
//        the numbers stayed CONTIGUOUS and only the `next_seq` assertion went
//        red. Invoice creation takes the workspace counter's row lock first
//        (`allocateSeq`), which already serialises creates in one workspace.
//        Recorded so nobody reads contiguity alone as proof of the company lock:
//        the `next_seq` assertion is what sees an allocator that stopped counting
//   #76  appendFieldChanges removed from editInvoice → "one audit row per
//        changed field" went red; removed from setInvoiceLines → the line-path
//        case went red
//   #76  (not a mutation — the first run) the line-path case was RED against
//        the phase-1 code: every line replacement logged a phantom
//        `items[0].qty` change, `1` against Postgres's `1.000`. Fixed in
//        `sameValue` (invoices.ts); the 8.10 → 8.1 case guards the edit path
//   #77  uq_idempotency_ws_key dropped as the owner → two requests with one key
//        created TWO invoices. Recreating the constraint then FAILED, because the
//        run had written duplicate keys; the duplicates were deleted, the
//        constraint recreated, and `pg_constraint`/`pg_indexes` read back. A
//        database mutation must be undone by checking the catalog, not by
//        assuming the ADD succeeded
//
// WATCHED FAILING, 2026-09-23 (ticket #757) — each restored; the full table is
// in apps/billing/docs/backend.md
//   stale key    the takeover's age predicate made never-true → 409 on the retry
//   fresh key    PENDING_ABANDONED_MS = 0 → the handler ran (201 where 409 was due)
//   duplicates   the invoice mapping returning the raw error; the company
//                create's catch predicate made false → "Failed query … to be an
//                instance of InvoiceRefused / CompanyRefused"
//   wired        normaliseCompanyFields replaced by the identity in both paths
//                → `expected undefined to be 'invalid_iban'`
//   audit        `subject_seq: r.subject_id` restored → `expected 1817 to be 1`
//   negatives    assertReadyToIssue softened to `< 0` → the zero-total draft got
//                past it; then `CHECK (unit_price >= 0) NOT VALID` added as the
//                owner → the -50.00 line refused by the database. Dropped, and
//                pg_constraint read back 0

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'billing write paths: allocator, audit rows, idempotency',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

run('billing write paths (integration)', () => {
  let getDb: typeof import('../client')['getDb']
  let sql: typeof import('drizzle-orm')['sql']
  let invoices: typeof import('./invoices')
  let lifecycle: typeof import('./lifecycle')
  let withIdempotency: typeof import('@/lib/api/idempotency')['withIdempotency']
  let NextRequest: typeof import('next/server')['NextRequest']
  let NextResponse: typeof import('next/server')['NextResponse']

  let ctx: { workspaceId: number; actorUserId: number; via: 'token'; actorEmail: string }
  let companySlug: string
  let companyId: number

  const auditFor = async (invoiceSeq: number) => {
    const r = await getDb().execute<{ action: string; field: string | null; from_value: string | null; to_value: string | null }>(sql`
      SELECT a.action, a.field, a.from_value, a.to_value
        FROM billing.audit a
        JOIN billing.invoice i ON i.id = a.subject_id AND a.subject_type = 'invoice'
       WHERE i.workspace_id = ${ctx.workspaceId} AND i.seq = ${invoiceSeq}
       ORDER BY a.seq`)
    return r.rows
  }

  beforeAll(async () => {
    ;({ getDb } = await import('../client'))
    ;({ sql } = await import('drizzle-orm'))
    invoices = await import('./invoices')
    lifecycle = await import('./lifecycle')
    ;({ withIdempotency } = await import('@/lib/api/idempotency'))
    ;({ NextRequest, NextResponse } = await import('next/server'))
    const workspaces = await import('./workspaces')
    const companies = await import('./companies')

    const who = await getDb().execute<{ current_user: string }>(sql`SELECT current_user`)
    // Stated in the output, so a run as the owner is visible rather than silent.
    process.stderr.write(`\n  write-paths integration suite running as: ${who.rows[0]?.current_user}\n`)

    const u = await getDb().execute<{ id: number; email: string }>(sql`SELECT id, email FROM platform.users ORDER BY id LIMIT 1`)
    const user = u.rows[0]
    if (!user) throw new Error('no user in platform.users — sign up locally first')

    const stamp = Date.now()
    const ws = await workspaces.createWorkspaceForUser(user.id, `itest-${stamp}`)
    ctx = { workspaceId: ws.id, actorUserId: user.id, via: 'token', actorEmail: user.email }
    companySlug = `itest-${stamp}`
    await companies.createCompany(
      { workspaceId: ws.id, actorUserId: user.id, via: 'token', isOwner: true },
      { slug: companySlug, name: 'Integration Test SA', number_format: 'IT-{SEQ4}' } as never
    )
    const c = await getDb().execute<{ id: number }>(sql`SELECT id FROM billing.company WHERE workspace_id = ${ws.id} AND slug = ${companySlug}`)
    companyId = c.rows[0].id
  })

  afterAll(async () => {
    // The pool is global (platform-db); vitest's process exit closes it.
  })

  const draft = (extra: Record<string, unknown> = {}) =>
    invoices.createInvoice(ctx, {
      company: companySlug,
      ref_type: 'NON',
      client: { name: 'Client SA' },
      items: [{ description: 'Work', qty: '1', unit_price: '100.00' }],
      ...extra,
    } as never)

  // -------------------------------------------------------------------------
  // #75 — the gapless allocator
  // -------------------------------------------------------------------------

  it('#75 twenty concurrent creates produce twenty contiguous numbers', async () => {
    const before = await getDb().execute<{ next_seq: number }>(sql`SELECT next_seq FROM billing.company WHERE id = ${companyId}`)
    const start = Number(before.rows[0].next_seq)

    const results = await Promise.allSettled(Array.from({ length: 20 }, () => draft()))
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(rejected.map((r) => String(r.reason?.cause?.message ?? r.reason?.message ?? r.reason))).toEqual([])

    const seqNos = results
      .map((r) => (r as PromiseFulfilledResult<{ seq_no: number }>).value.seq_no)
      .sort((a, b) => a - b)
    expect(seqNos).toEqual(Array.from({ length: 20 }, (_, i) => start + i))

    const after = await getDb().execute<{ next_seq: number }>(sql`SELECT next_seq FROM billing.company WHERE id = ${companyId}`)
    expect(Number(after.rows[0].next_seq)).toBe(start + 20)
  }, 60_000)

  it('#75 a voided number stays consumed: the next create takes the following one', async () => {
    const a = await draft()
    const voided = await lifecycle.voidInvoice(ctx, String(a.seq), { reason_en: 'integration test' })
    expect(voided.status).toBe('void')
    expect(voided.number).toBe(a.number)
    const b = await draft()
    expect(b.seq_no).toBe(a.seq_no + 1)
  })

  // -------------------------------------------------------------------------
  // #76 — every write leaves exactly its audit rows
  // -------------------------------------------------------------------------

  it('#76 a create leaves exactly one `created` row', async () => {
    const inv = await draft()
    expect((await auditFor(inv.seq)).map((r) => r.action)).toEqual(['created'])
  })

  it('#76 an edit leaves one row per changed field, and none for an unchanged one', async () => {
    const inv = await draft({ message: 'first' })
    await invoices.editInvoice(ctx, String(inv.seq), { message: 'second', due_date: '2027-01-31', language: inv.language })
    const rows = (await auditFor(inv.seq)).filter((r) => r.action === 'field_changed')
    expect(rows.map((r) => [r.field, r.from_value, r.to_value]).sort()).toEqual(
      [
        ['due_date', inv.due_date, '2027-01-31'],
        ['message', 'first', 'second'],
      ].sort()
    )
  })

  it('#76 an edit that only re-spells a decimal (8.10 → 8.1) logs nothing', async () => {
    // Postgres returns numeric(5,2) as `8.10`. A caller sending `8.1` changed
    // nothing, and the log must not say it did.
    const inv = await draft()
    await invoices.editInvoice(ctx, String(inv.seq), { vat_rate: '8.10' })
    await invoices.editInvoice(ctx, String(inv.seq), { vat_rate: '8.1' })
    const rates = (await auditFor(inv.seq)).filter((r) => r.field === 'vat_rate')
    expect(rates.map((r) => [r.from_value, r.to_value])).toEqual([[null, '8.10']])
  })

  it('#76 a line replacement leaves one row per changed LINE PATH', async () => {
    const inv = await draft()
    await invoices.setInvoiceLines(ctx, String(inv.seq), [
      { description: 'Work', qty: '1', unit_price: '120.00' },
      { description: 'Travel', qty: '1', unit_price: '30.00' },
    ] as never)
    const rows = (await auditFor(inv.seq)).filter((r) => r.action === 'field_changed')
    expect(rows.map((r) => r.field).sort()).toEqual(['items[0].unit_price', 'items[1]'])
    const price = rows.find((r) => r.field === 'items[0].unit_price')!
    expect([price.from_value, price.to_value]).toEqual(['100.00', '120.00'])
  })

  // -------------------------------------------------------------------------
  // #77 — one key, one invoice, even when the two requests race
  // -------------------------------------------------------------------------

  it('#77 two concurrent requests with one Idempotency-Key create ONE invoice', async () => {
    const key = `itest-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const body = { company: companySlug, ref_type: 'NON', client: { name: 'Race SA' }, items: [{ description: 'x', unit_price: '10.00' }] }
    const request = () =>
      new NextRequest(`http://localhost:3300/api/workspaces/itest/invoices`, {
        method: 'POST',
        headers: { 'idempotency-key': key, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const handler = async () => NextResponse.json(await invoices.createInvoice(ctx, body as never), { status: 201 })

    const count = async () =>
      Number(
        (await getDb().execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM billing.invoice i
            JOIN billing.invoice_line l ON l.invoice_id = i.id
           WHERE i.workspace_id = ${ctx.workspaceId} AND i.client->>'name' = 'Race SA'`)).rows[0].n
      )
    const before = await count()

    const outcomes = await Promise.allSettled([
      withIdempotency(request(), ctx.workspaceId, body, handler),
      withIdempotency(request(), ctx.workspaceId, body, handler),
    ])
    // The loser is either a replay (the winner finished first) or a 409
    // "still running" (it did not). Both are correct; a second invoice is not.
    const statuses = outcomes.map((o) =>
      o.status === 'fulfilled' ? o.value.status : (o.reason as { status?: number }).status ?? 'threw'
    )
    expect(statuses).toContain(201)
    expect(await count()).toBe(before + 1)
  })

  // -------------------------------------------------------------------------
  // #757 — hardening before production (2026-09-23)
  // -------------------------------------------------------------------------

  const keyedRequest = (key: string, body: unknown) =>
    new NextRequest(`http://localhost:3300/api/workspaces/itest/invoices`, {
      method: 'POST',
      headers: { 'idempotency-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('#757 a `pending` key whose request died is reclaimed: the retry runs once and completes', async () => {
    const { PENDING_ABANDONED_MS } = await import('@/lib/api/idempotency')
    const key = `itest-stale-${Date.now()}`
    const body = { company: companySlug, ref_type: 'NON', client: { name: 'Stale SA' }, items: [{ description: 'x', unit_price: '10.00' }] }
    // The request hash the module would compute for this exact request, so the
    // simulated dead claim is the SAME request — a different hash is the 422
    // path, which is not what a killed process leaves behind.
    let ran = 0
    const probe = await withIdempotency(keyedRequest(`${key}-probe`, body), ctx.workspaceId, body, async () => {
      ran++
      return NextResponse.json({ probe: true }, { status: 201 })
    })
    expect(probe.status).toBe(201)
    const hash = (await getDb().execute<{ request_hash: string }>(sql`
      SELECT request_hash FROM billing.idempotency_keys WHERE workspace_id = ${ctx.workspaceId} AND key = ${`${key}-probe`}`)).rows[0].request_hash

    // A claim left `pending` longer than any route may run: the process is gone.
    await getDb().execute(sql`
      INSERT INTO billing.idempotency_keys (workspace_id, key, request_hash, status, created_at)
      VALUES (${ctx.workspaceId}, ${key}, ${hash}, 'pending', now() - make_interval(secs => ${PENDING_ABANDONED_MS / 1000 + 5}))`)

    ran = 0
    const retry = await withIdempotency(keyedRequest(key, body), ctx.workspaceId, body, async () => {
      ran++
      return NextResponse.json(await invoices.createInvoice(ctx, body as never), { status: 201 })
    })
    expect(retry.status).toBe(201)
    expect(retry.headers.get('Idempotent-Replayed')).toBeNull()
    expect(ran).toBe(1)

    const row = (await getDb().execute<{ status: string; response_status: number }>(sql`
      SELECT status, response_status FROM billing.idempotency_keys WHERE workspace_id = ${ctx.workspaceId} AND key = ${key}`)).rows[0]
    expect(row).toEqual({ status: 'done', response_status: 201 })

    // And a second retry now REPLAYS rather than running again.
    const again = await withIdempotency(keyedRequest(key, body), ctx.workspaceId, body, async () => {
      ran++
      return NextResponse.json({ never: true }, { status: 201 })
    })
    expect(again.headers.get('Idempotent-Replayed')).toBe('true')
    expect(ran).toBe(1)
  })

  it('#757 a FRESH `pending` key is still in progress: 409, and the handler does not run', async () => {
    const key = `itest-fresh-${Date.now()}`
    const body = { company: companySlug, ref_type: 'NON', client: { name: 'Fresh SA' }, items: [{ description: 'x', unit_price: '10.00' }] }
    const probe = await withIdempotency(keyedRequest(`${key}-probe`, body), ctx.workspaceId, body, async () =>
      NextResponse.json({ probe: true }, { status: 201 })
    )
    expect(probe.status).toBe(201)
    const hash = (await getDb().execute<{ request_hash: string }>(sql`
      SELECT request_hash FROM billing.idempotency_keys WHERE workspace_id = ${ctx.workspaceId} AND key = ${`${key}-probe`}`)).rows[0].request_hash
    await getDb().execute(sql`
      INSERT INTO billing.idempotency_keys (workspace_id, key, request_hash, status, created_at)
      VALUES (${ctx.workspaceId}, ${key}, ${hash}, 'pending', now() - interval '5 seconds')`)

    let ran = 0
    const outcome = await withIdempotency(keyedRequest(key, body), ctx.workspaceId, body, async () => {
      ran++
      return NextResponse.json({ never: true }, { status: 201 })
    }).then(
      (r) => ({ status: r.status, code: 'fulfilled' }),
      (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code })
    )
    expect(outcome).toEqual({ status: 409, code: 'idempotency_in_progress' })
    expect(ran).toBe(0)
  })

  it('#757 a duplicate invoice external_ref is 409 external_ref_taken naming the holder, on create and on edit', async () => {
    const ref = `appt-${Date.now()}`
    const first = await draft({ external_ref: ref })
    expect(first.external_ref).toBe(ref)

    const onCreate = await draft({ external_ref: ref }).then(
      () => null,
      (e: unknown) => e
    )
    expect(onCreate).toBeInstanceOf(invoices.InvoiceRefused)
    const c = onCreate as InstanceType<typeof invoices.InvoiceRefused>
    expect(c.code).toBe('external_ref_taken')
    expect(c.status).toBe(409)
    expect(c.message).toContain(`#${first.seq}`)
    expect(c.message).toContain(first.number)
    expect(c.suggestion).toContain(`invoice show ${first.seq}`)

    const other = await draft()
    const onEdit = await invoices.editInvoice(ctx, String(other.seq), { external_ref: ref }).then(
      () => null,
      (e: unknown) => e
    )
    expect(onEdit).toBeInstanceOf(invoices.InvoiceRefused)
    expect((onEdit as { code: string }).code).toBe('external_ref_taken')
    expect((onEdit as { message: string }).message).toContain(`#${first.seq}`)
    // The refused create released its number: the next draft takes the one
    // after `other`, not one after a hole.
    const next = await draft()
    expect(next.seq_no).toBe(other.seq_no + 1)
  })

  it('#757 a duplicate company external_ref is 409 external_ref_taken naming the holder, on create and on edit', async () => {
    const companies = await import('./companies')
    const wctx = { workspaceId: ctx.workspaceId, actorUserId: ctx.actorUserId, via: 'token' as const, isOwner: true }
    const ref = `branch-${Date.now()}`
    const first = await companies.createCompany(wctx, { slug: `br-${Date.now()}`, name: 'Branch One', external_ref: ref } as never)

    const onCreate = await companies
      .createCompany(wctx, { slug: `br2-${Date.now()}`, name: 'Branch Two', external_ref: ref } as never)
      .then(() => null, (e: unknown) => e)
    expect(onCreate).toBeInstanceOf(companies.CompanyRefused)
    const c = onCreate as InstanceType<typeof companies.CompanyRefused>
    expect(c.code).toBe('external_ref_taken')
    expect(c.status).toBe(409)
    expect(c.message).toContain(`#${first.seq}`)
    expect(c.message).toContain(first.slug)

    const onEdit = await companies.editCompany(wctx, companySlug, { external_ref: ref }).then(() => null, (e: unknown) => e)
    expect(onEdit).toBeInstanceOf(companies.CompanyRefused)
    expect((onEdit as { code: string }).code).toBe('external_ref_taken')
  })

  it('#757 the company field checks are wired into BOTH write paths, and an IBAN is stored compact', async () => {
    const companies = await import('./companies')
    const wctx = { workspaceId: ctx.workspaceId, actorUserId: ctx.actorUserId, via: 'token' as const, isOwner: true }

    const badCreate = await companies
      .createCompany(wctx, { slug: `bad-${Date.now()}`, name: 'Bad IBAN', iban: 'CH9400762011623852957' } as never)
      .then(() => null, (e: unknown) => e)
    expect((badCreate as { code?: string })?.code).toBe('invalid_iban')

    const badEdit = await companies.editCompany(wctx, companySlug, { country: 'Schweiz' }).then(() => null, (e: unknown) => e)
    expect((badEdit as { code?: string })?.code).toBe('invalid_country')

    const edited = await companies.editCompany(wctx, companySlug, { iban: 'CH93 0076 2011 6238 5295 7', country: 'ch' })
    expect(edited.iban).toBe('CH9300762011623852957')
    expect(edited.address.country).toBe('CH')
  })

  it('#757 negative lines are accepted and total correctly; a non-positive total is still refused at issue', async () => {
    // The integration sends a discount as a negative line. Nothing forbade it
    // and nothing promised it; this pins both halves so a future CHECK cannot
    // silently break the mapping.
    const discounted = await draft({
      items: [
        { description: 'Treatment', qty: '1', unit_price: '150.00' },
        { description: 'Loyalty discount', qty: '1', unit_price: '-50.00' },
      ],
    })
    expect(discounted.items[1].line_total).toBe('-50.00')
    expect(discounted.totals.total).toBe('100.00')

    const credit = await draft({
      items: [
        { description: 'Treatment', qty: '1', unit_price: '100.00' },
        { description: 'Refund', qty: '1', unit_price: '-100.00' },
      ],
    })
    expect(credit.totals.total).toBe('0.00')
    const lctx = { ...ctx, actorEmail: ctx.actorEmail }
    const refused = await lifecycle
      .markInvoiceSent(lctx, String(credit.seq), { prepareDocument: async () => ({}) } as never)
      .then(() => null, (e: unknown) => e)
    expect((refused as { code?: string })?.code).toBe('total_not_positive')
    expect((await invoices.getInvoice(ctx.workspaceId, String(credit.seq)))?.status).toBe('draft')
  })

  it('#757 the audit feed serves the subject’s #seq (and its external_ref), not its row id', async () => {
    const audit = await import('./audit')
    const ref = `feed-${Date.now()}`
    const inv = await draft({ external_ref: ref })
    const row = await invoices.getInvoiceRow(ctx.workspaceId, String(inv.seq))
    const rowId = Number(row!.id)
    // Assert the input: in this database the two numbers differ, so a feed
    // that served the row id could not pass by coincidence.
    expect(rowId).not.toBe(inv.seq)

    const page = await audit.listAudit(ctx.workspaceId, { subjectType: 'invoice', subjectId: rowId })
    expect(page.data.length).toBeGreaterThan(0)
    for (const entry of page.data) {
      expect(entry.subject_seq).toBe(inv.seq)
      expect(entry.subject_external_ref).toBe(ref)
    }

    // The company rows resolve through their own table.
    const companyRows = (await audit.listAudit(ctx.workspaceId, { subjectType: 'company' })).data
    expect(companyRows.length).toBeGreaterThan(0)
    const companyRow = await getDb().execute<{ id: number; seq: number }>(sql`SELECT id, seq FROM billing.company WHERE id = ${companyId}`)
    const mine = companyRows.find((r) => r.subject_seq === Number(companyRow.rows[0].seq))
    expect(mine, 'the test company’s created row resolves to its #seq').toBeDefined()
  })

  // -------------------------------------------------------------------------
  // 2026-09-23 — `exact_0_05`, end to end: refused by name, accepted by the
  // database, derived by the read
  // -------------------------------------------------------------------------
  // `totals.test.ts` proves the arithmetic on a fixture. This proves the path
  // AROUND it: the refusal an agent sees names every policy (a value the
  // message omits is a policy nobody can discover); migration 0013's CHECK
  // accepts the row; and the read derives through the company's policy rather
  // than a default — shown by switching the policy and reading again.

  it('exact_0_05: the refusal names four policies, the CHECK accepts the row, the read derives through it', async () => {
    const companies = await import('./companies')
    const cctx = { workspaceId: ctx.workspaceId, actorUserId: ctx.actorUserId, via: 'token' as const, isOwner: true }

    let refused: unknown
    try {
      await companies.createCompany(cctx, { slug: `${companySlug}-bad`, name: 'Bad', rounding: 'exact_0_5' } as never)
    } catch (e) {
      refused = e
    }
    expect(refused).toBeInstanceOf(companies.CompanyRefused)
    const r = refused as InstanceType<typeof companies.CompanyRefused>
    expect(r.code).toBe('invalid_rounding')
    for (const policy of ['line_0_05', 'total_0_05', 'exact_0_05', 'none']) expect(r.suggestion).toContain(policy)

    // THE POSITIVE HALF: the row lands, past 0013's CHECK, and reads back.
    const slug = `${companySlug}-exact`
    const co = await companies.createCompany(
      cctx,
      { slug, name: 'Exact SA', rounding: 'exact_0_05', number_format: 'EX-{SEQ4}' } as never
    )
    expect(co.rounding).toBe('exact_0_05')

    // The fixture from totals.test.ts, through the real read path. Exempt
    // lines (the company charges no VAT), prices including VAT.
    //   0.5 × 12.35 = 6.175 → prints 6.18;  0.333 × 12.45 = 4.14585 → prints 4.15
    //   exact sum 10.32085 → ONE rounding → 10.30;  printed 10.33, Arrondi −0.03
    const inv = await invoices.createInvoice(ctx, {
      company: slug,
      ref_type: 'NON',
      client: { name: 'Client SA' },
      prices_include_vat: true,
      items: [
        { description: 'half', qty: '0.5', unit_price: '12.35' },
        { description: 'third', qty: '0.333', unit_price: '12.45' },
      ],
    } as never)
    expect(inv.items.map((i) => i.line_total)).toEqual(['6.18', '4.15'])
    expect(inv.totals).toMatchObject({ subtotal: '10.33', rounding: '-0.03', total: '10.30' })

    // The policy is READ, not defaulted: the same draft under `total_0_05`
    // rounds the lines first and lands on 10.35.
    await companies.editCompany(cctx, slug, { rounding: 'total_0_05' })
    const again = await invoices.getInvoice(ctx.workspaceId, String(inv.seq))
    expect(again!.totals).toMatchObject({ subtotal: '10.33', rounding: '0.02', total: '10.35' })
  })
})
