# Phase 2: References, QR and PDF

**Goal:** an invoice produces a byte-stable, spec-compliant PDF with a Swiss
QR-bill payment part on it, and the payment reference is derived rather than
typed.

**Read [`qr-bill.md`](qr-bill.md) first, fully.** This phase is the highest-risk
work in the project and the only one whose acceptance test lives outside the
repo.

- **The problem** — nothing in this repository has ever produced a PDF or a QR
  code. There is no PDF library, no QR library, no Google API client and no
  decimal library in any `package.json` or in `cli/go.mod`. Meanwhile the thing
  to be produced is a banking instrument with mandatory millimetre geometry, a
  997-character payload whose line endings are load-bearing, two check-digit
  algorithms, a matrix of illegal combinations, and fixed legal literals in four
  languages. A plausible-looking payment part that is subtly wrong is money
  arriving at the wrong account, and the failure is invisible until a client
  complains.
- **What this phase does** — builds `lib/qr/` as pure functions with no I/O: the
  reference algorithms, the character-set and IBAN validators, the combination
  matrix, the Annex C literals and the Table-8 serializer, each tested against
  the spec's own verified vectors. Then `lib/pdf/`, drawing the A4 page and the
  210 × 105 mm payment part with `pdf-lib` at true millimetre coordinates, the
  QR matrix from `qrcode` drawn as rectangles at exactly 46 × 46 mm with the
  Swiss cross over it, in Liberation Sans. Two routes expose the PDF and the raw
  payload; the on-screen preview renders from the same derived block the PDF
  does.
- **Expected result** — `GET …/invoices/{ref}/pdf` returns a PDF whose page box
  is 210 × 297 mm and whose QR box is 46 × 46 mm; the serializer reproduces the
  standard's own Example 2 payload byte for byte; both check-digit vectors pass;
  every illegal combination is refused; the same invoice rendered twice produces
  **identical bytes**; and one bill of each of the four shapes has been through
  the SIX validation portal and scanned by two banking apps, with the transcript
  recorded.

## In one look

| | |
|---|---|
| **Data** | Nothing new is stored. `ref_body` already exists and holds the reference **without** its check digit, because the check digit is derived every time. |
| **Logic** | Derive the reference and its check digit, two algorithms for two types. Refuse the combinations the standard forbids. Serialize the payload. Draw the page and the payment part. |
| **UI** | Download PDF, Preview PDF, and the payment part drawn on screen exactly as it will print. |

## Module diagram

```
┌─ UI ────────────────────────────────────────────────────────
│  components/payment-part.tsx   mm-exact, from `derived`  new
│  components/invoice-actions.tsx  preview / download      new
└─────────────────────────────────────────────────────────────

┌─ CLI ───────────────────────────────────────────────────────
│  commands/billing/invoice.go   pdf, qr subcommands  altered
│  client/billing.go             getBytes             altered
└─────────────────────────────────────────────────────────────

┌─ BUSINESS LOGIC ────────────────────────────────────────────
│  app/api/workspaces/[ws]/invoices/[ref]/pdf/route.ts     new
│  app/api/workspaces/[ws]/invoices/[ref]/qr/route.ts      new
│  lib/qr/reference.ts  charset.ts  payload.ts             new
│  lib/qr/validate.ts   labels.ts                          new
│  lib/pdf/invoice.ts   payment-part.ts  mm.ts             new
│  lib/pdf/fonts/LiberationSans-{Regular,Bold}.ttf      vendored
└─────────────────────────────────────────────────────────────

┌─ DATA ──────────────────────────────────────────────────────
│  no migration
└─────────────────────────────────────────────────────────────
```

**New dependencies, `apps/billing` only:** `pdf-lib`, `@pdf-lib/fontkit`,
`qrcode`. Nothing in `cli/go.mod` — the CLI streams bytes it does not
understand.

**Shared files this phase alters:** none.

## Build

### `lib/qr/` — pure, no I/O, ours to read

The constraint from `dev-handoff/TECH-STACK.md` §3, and it is the reason this is
in-house: **a library may render the QR image and help with layout, but the
payload bytes and the validation rules must be ours to read and test.** The
standard's §6 checklist is only an acceptance test if we own what it tests.

| Module | Contents |
|---|---|
| `reference.ts` | `refQRR(body26)` — modulo-10 recursive with the carry table. `refSCOR(body)` — ISO 11649 modulo 97-10. `validateSCOR(ref)`. `invoiceReference(invoice)` → the full reference or `null` for NON. `invoiceAccount(invoice, company)` → `qr_iban` for QRR, else `iban`. `isQrIban(iban)` → the 30000–31999 IID test. `ibanCheckDigits(iban)` → ISO 13616. **`refBodyFor(company, invoice)`** — the P11 scheme, declared here and nowhere else. |
| `charset.ts` | The §4.1.1 codepoint test, and a `describe` that names the offending character and its position. **Rejects; never transliterates.** |
| `labels.ts` | The Annex C literals per language, `fr`/`de`/`it`/`en` with `rm` stubbed out. **Legal text: never reworded, never machine-translated, never interpolated.** A frozen object, and a test that its key set is identical across languages. |
| `payload.ts` | The Table-8 serializer. Takes `{company, invoice, lines, totals}` and returns a string. 31 base lines always, A-lines omitted with their separators, one line ending, no trailing newline, ≤ 997 characters. |
| `validate.ts` | Everything that can refuse: the combination matrix, structured-address completeness and length caps, the amount range and format, CHF/EUR for the payment part, the 140-character shared budget. Returns `{code, message, suggestion}` refusals the route maps onto `Errors.badRequest`. |

**The formatting split, and it catches people:** three amount formats coexist.
`1590.00` in the payload, `CHF 1 590.00` on the printed part (space thousands
separator, §3.5.4), and whatever the UI locale says on screen. One function per
format, each tested, and none of them constructing a `Number`.

### `lib/pdf/`

`mm.ts` first: `pdf-lib` works in points, the spec works in millimetres, and
every coordinate in this phase is a millimetre. One conversion
(`mm → mm * 72 / 25.4`), used everywhere, so a stray unit is a compile-time
mismatch rather than a 3 mm drift.

**Fonts.** Vendor `LiberationSans-Regular.ttf` and `LiberationSans-Bold.ttf`
under `lib/pdf/fonts/`, embedded with `@pdf-lib/fontkit`. It is one of the four
fonts the standard permits and the only one of them that is freely
redistributable. Record the licence beside the files.

**`payment-part.ts`** draws the bottom 105 mm of the page: the 62 mm receipt, the
148 mm payment part, their five and four sections, the block-formatted IBAN and
reference, the amount, the blank hand-fill boxes at their mandated sizes when the
amount or the debtor is absent, and the separation hint. Geometry and type sizes
come from [`qr-bill.md`](qr-bill.md) §6.

The QR itself: `qrcode` produces the module matrix; **draw it as rectangles**,
scaled so the symbol is exactly 46 × 46 mm regardless of version, with a 5 mm
quiet border and the 7 × 7 mm Swiss cross centred on top. Do not use a PNG — a
raster at 46 mm is either heavy or soft, and the spec says scale from vector.

**`invoice.ts`** draws the A4 body above it in the **document's** language:
issuer block, client block, the line table, subtotal, one VAT line per distinct rate (`dont TVA …` when prices include VAT), an `Arrondi` line when the rounding policy produces one, total, the payment
message, the footer. A non-CHF/EUR invoice gets the body and **no payment part** —
that is a valid Swiss invoice, just not a payable slip.

### Byte-stability, and why it is a requirement here rather than a nicety

Position **P10**: the sent PDF is **not archived**, it is regenerated on demand,
and the sha256 of what was actually sent is recorded on the audit entry in phase
3. That trade only holds if regenerating produces the same bytes.

So:

- Set `CreationDate` and `ModDate` explicitly from `issue_date`. `pdf-lib`
  defaults to `now()`, which alone makes every render differ.
- Pass `updateMetadata: false` when saving.
- Do not embed a random document id, a producer string carrying a version, or
  anything else derived from the run.
- **The test is `render(inv) === render(inv)` across two processes**, not within
  one. A same-process comparison passes on a memoised buffer.

If byte-stability turns out to be unreachable, the honest answer is to archive
the PDF instead and revisit P10 — not to record a hash of something that cannot
be reproduced.

## Routes and CLI

| Route | Command |
|---|---|
| `GET /api/workspaces/{ws}/invoices/{ref}/pdf` → `application/pdf` | `bk billing invoice pdf <ref> --out file.pdf` |
| `GET /api/workspaces/{ws}/invoices/{ref}/qr` → `text/plain` | `bk billing invoice qr <ref>` |

Both join `PUBLIC_ROUTES` in this phase ([`integration-surface.md`](integration-surface.md)
§1): the PDF and the payload are what a customer's system fetches after
creating a bill, and the byte-stability requirement above is what makes the
PDF safe to fetch twice.

`GET …/invoices/{ref}` gains a `derived` block: `{reference, reference_formatted,
account, account_formatted, totals, has_payment_part}`. The on-screen preview and
the PDF read the same block, so they cannot disagree.

Two CLI notes. The client gains a `getBytes` path — every existing method decodes
JSON, and a PDF is the first response that is not JSON; keep the redirect-following
and version-header handling, which means extending `do()` rather than writing a
second client. And `bk billing invoice qr` exists **because a human has to paste
a payload into the SIX validator**; it is also the cheapest way for an agent to
check its own work.

Both routes are reads, so neither writes an audit row.

## Done when

- [ ] Both check-digit vectors pass: QRR body `21000000000313947143000901` → `7`,
      and SCOR body `539007547034` → `RF18539007547034`
- [ ] A test asserts the PDF's Example 4 SCOR reference **fails** validation, so
      the erratum stays documented in code rather than only in prose
- [ ] The serializer reproduces the standard's Example 2 payload **byte for
      byte**, including its line endings and the absence of a trailing newline
- [ ] A payload with an unused `StrdBkgInf` **omits the line and its separator**,
      and one with two `AltPmt` values emits exactly two
- [ ] Every illegal combination is refused with a `suggestion`: QR-IBAN + SCOR,
      IBAN + QRR, EUR + QRR, NON with a non-empty body, QRR on a company with no
      `qr_iban`
- [ ] A creditor name containing a character outside §4.1.1 is refused, naming
      the character and its position
- [ ] `len(message) + len(billing_info) > 140` is refused
- [ ] The rendered PDF measures 210 × 297 mm, its QR box 46 × 46 mm, its payment
      part 148 × 105 mm and its receipt 62 × 105 mm — **measured from the saved
      file**, not asserted from the input
- [ ] `render(inv)` in two separate processes produces identical bytes
- [ ] An invoice with no debtor renders the blank "Payable by (name/address)" box
      at its mandated size; one with no amount renders the amount box
- [ ] A USD invoice renders the body and **no payment part**
- [ ] The Annex C literals are correct in all four languages, checked against the
      spec rather than against each other
- [ ] **These were watched failing, then restored:** one line ending changed in
      the serializer; the A-line omission replaced with an empty line; the carry
      table's last two entries swapped; `CreationDate` left at its default; the
      QR drawn at 45 mm; one Annex C literal reworded
- [ ] **Tier 2 and tier 3 of [`qr-bill.md`](qr-bill.md) §8 are done** — four
      bills through the SIX validation portal, two banking apps scanning a
      printed page and a screen — and the transcript is in
      `apps/billing/docs/backend.md` with its commit hash

## Progress

**#84, `lib/qr/`, built 2026-09-17** on `feat/billing-phase-2-be`. Every `lib/qr`
item in "Done when" above holds except the ones that need a PDF; the details and
the mutations are in `apps/billing/docs/backend.md` under "Phase 2, ticket #84".
What building it changed, so this doc is not re-read as a plan for it:

- `refBodyFor` lives in `lib/qr/reference.ts` as `referenceBodyFor`, moved from
  `lib/derive/reference.ts` rather than duplicated.
- The SCOR body limit is 21, not 25; migration **0008** corrects phase 1's CHECK
  and refuses to apply over a row that violates it.
- `validate.ts` returns every refusal, not the first.
- The test oracle is `swissqrbill` 4.4.1's utilities plus its internal payload
  generator, loaded by path; one recorded disagreement (line 32 when only an
  alternative procedure is used).
- The full extraction is vendored at `apps/billing/docs/qr-bill-spec.md`.

**#85 (`lib/pdf/`) and #86 (routes, `bk`, the seam) are not started.**

## Frontend gets

The payment part as a React component, rendered in true millimetres from the
`derived` block, plus Preview and Download actions on the invoice. The mockup's
own HTML and CSS payment part is the layout reference — port it rather than
reinvent it, and keep the deliberately-unscannable placeholder out: this phase
replaces it with a real matrix.

## Notes

**The mockup's QR is a deliberate fake.** `BL_FAKE_QR` draws the right shape,
finder patterns and Swiss cross, and is unscannable on purpose. Do not port it,
and do not let it linger beside the real one — a fake QR that survives into a
real app is a bill nobody can pay, and it looks completely correct.

**`qrcode` renders; it does not decide.** Use it for the module matrix and
nothing else: not for the payload, not for the error-correction choice, not for
sizing. Everything it is not responsible for is in `lib/qr/`.

**Do not reach for a Swiss QR-bill library at this point.** One exists and is
maintained, and the reason to keep the payload in-house is that §6 is the
acceptance test and it can only test code we can read. That said, the
maintained library is the right **second opinion**: if a payload disagrees with
it, one of the two is wrong and finding out which is cheap. Use it in a test,
never on the request path.

**A route is not a page, one more time.** The preview component and the PDF
renderer are two implementations of one layout, and only one of them is reachable
by `curl`. Open the preview in a browser and compare it to the downloaded file
side by side, at 100%, for each of the four shapes. A test that both exist proves
nothing about whether they agree.

**Storage stays untouched.** This app has no `AppContext.uploads` and no blob
trigger. Generating a PDF on demand is what keeps that true, and it is the second
reason P10 is answered the way it is: the moment a generated PDF is stored, this
app owns a column that can hold a file URL, and **that column needs a
`platform.blob_references` trigger in the same migration**. Read
`packages/platform-storage/src/references.ts` before going anywhere near that.
