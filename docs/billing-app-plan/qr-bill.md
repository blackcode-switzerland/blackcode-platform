# The Swiss QR-bill, as it binds this app

**Read before [phase 2](phase-2-references-qr-and-pdf.md).**

- **The problem** — the payment part of an invoice is not a design; it is a
  banking instrument governed by a published standard with mandatory geometry,
  a fixed payload format, two check-digit algorithms and a matrix of
  combinations that are simply illegal. A bill that looks right and is wrong
  gets rejected at a counter, or worse, settles to the wrong account. The
  standard also has two versions in parallel validity right now, with different
  rules for euro bills.
- **What this doc does** — states which version we build to and why, reproduces
  the parts an implementer needs to hold in their head (the combination matrix,
  the payload line list, both algorithms with their verified test vectors, the
  geometry and the typography), and defines how a bill is proven correct before
  a real one is sent.
- **Expected result** — a builder who can write the serializer and the renderer
  without opening the 70-page PDF, knows which of its own examples not to trust,
  and knows the two things that must happen outside the test suite before the
  first real invoice goes out.

## Provenance, and what is authoritative

| | |
|---|---|
| **The authority** | SIX Interbank Clearing Ltd, *Swiss Implementation Guidelines for the QR-bill*. Section references below are `§`. |
| **The extraction** | `b-mockups/bbilling/research/QR-BILL-TECHNICAL-SPEC.md`, read out of `ig-qr-bill-v2.4-en.pdf` (v2.4, 24.02.2026, 70 pp) in that same folder. Both algorithms and both test vectors in it were verified computationally. |
| **This file** | a digest of that extraction plus the version timeline, which the extraction does not carry. Phase 2 vendors the full extraction into `apps/billing/docs/qr-bill-spec.md`, because the mockup repo is not guaranteed to be on a builder's machine. |
| **Where they disagree** | the PDF wins, then the extraction, then this file. If you change one, say which. |

The public landing page, for the downloads and the current validity dates:
`https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/qr-bill.html`

## 1. Which version, and the dates that matter

| Version | Status |
|---|---|
| **v2.3** | **in force today.** Valid from 21 November 2025, and stays valid until **November 2027**. |
| **v2.4** | published 24 February 2026, **takes effect 14 November 2026**. |

**We build to v2.4's rules**, because every bill valid under v2.4 is also valid
under v2.3, and nothing then has to change on 14 November 2026. The mockup
already does this.

What v2.4 changes, and all three matter to this app:

1. **QR-IBAN and the QR reference become CHF-only.** For euro bills, only
   IBAN + SCOR or IBAN + unstructured message remain. Euro QR-bills settle as
   SEPA Credit Transfers from November 2027 at the latest, and the transfer of
   the ultimate-debtor address and of supplementary data is **not guaranteed**
   for euro. The mockup's BC-2026-0035 demonstrates exactly this: an EUR bill
   on the regular IBAN with a SCOR reference, and an audit entry saying why.
2. **The structured address is obligatory** — address type `S` only. The
   combined-address option `K` is gone from the data table. The mandate itself
   landed on 21 November 2025; v2.4 is where the alternative disappears from the
   spec. Either way: this app stores structured addresses and has no other mode.
3. **Romansh becomes the fifth correspondence language**, from 1 January 2026.
   Non-technical, but it means the Annex C literal table has five columns while
   this app's document-language vocabulary has four (`fr`, `de`, `it`, `en`).
   Adding `rm` later is a `CHECK` constraint change plus a dictionary column —
   small, and worth knowing it is not free.

Also as of 21 November 2025: the extended SPS character set applies (below).

## 2. The combination matrix — §7.1, §4.3.2

**Enforce this at the write door and reject. Do not warn.** This is invariant I4
of the mockup's data model, and `CHECK` constraints carry the half that does not
need the company row (phase 1, guard G4).

| Account | Reference type | Currencies | |
|---|---|---|---|
| QR-IBAN | `QRR` | **CHF only** | ✔ the only valid QR-IBAN combination |
| QR-IBAN | `SCOR` or `NON` | — | ✘ reject |
| regular IBAN | `SCOR` | CHF, EUR | ✔ |
| regular IBAN | `NON` | CHF, EUR | ✔ |
| regular IBAN | `QRR` | — | ✘ reject |

**How to tell the two apart:** parse positions 5–9 of the IBAN. If
`30000 ≤ IID ≤ 31999` it is a QR-IBAN, and the reference type must then be
`QRR`. A QR-IBAN is for incoming payments only, never for debits.

The IBAN itself: ISO 13616, exactly 21 characters, no spaces, and **only `CH`
or `LI`** country codes are permitted in a QR-bill.

## 3. The payload

ISO 18004 QR code, error correction level **M**, UTF-8 restricted to the
character set below, **maximum 997 characters** including separators. Generate in
the smallest version that fits, then scale to 46×46 mm. The largest that can
occur is version 25 (117×117 modules).

**Separator:** CR+LF *or* LF alone, one style used consistently throughout a
document, and the separator after the final element is **eliminated** (§4.1.4).

**Character set (§4.1.1)** — permitted codepoints, and nothing else:

- Basic Latin `U+0020`–`U+007E`
- Latin-1 Supplement `U+00A0`–`U+00FF`
- Latin Extended-A `U+0100`–`U+017F`
- plus exactly `Ș U+0218`, `ș U+0219`, `Ț U+021A`, `ț U+021B`, `€ U+20AC`

Reject anything outside it. **Do not transliterate silently** — a creditor name
that does not match the account holder is a rejected payment, and quietly
changing it is how that happens.

**Stated lengths are maxima. Padding with blanks up to the maximum is not
permitted** (§4.1.3).

### Status codes (§4.2.1)

| Code | Meaning |
|---|---|
| **M** | mandatory — delivered, filled |
| **D** | dependent — filled if its superordinate group is filled |
| **O** | optional — **delivered**, may be empty |
| **A** | additional — **omitted entirely when unused, with its separator.** Errors in an A-line must not cause rejection |
| **X** | do not fill — but the separator line is still sent |

### The 34 lines, in order (§4.2.2, Table 8)

| # | Group | Element | St. | Limit | Content |
|---|---|---|---|---|---|
| 1 | Header | QRType | M | 3 | `SPC` |
| 2 | Header | Version | M | 4 | `0200` |
| 3 | Header | Coding | M | 1 | `1` = UTF-8, restricted set |
| 4 | CdtrInf | IBAN | M | 21 | creditor IBAN or QR-IBAN, no spaces, CH/LI only |
| 5 | Cdtr | AdrTp | M | 1 | `S` — the only permitted value |
| 6 | Cdtr | Name | M | 70 | **must match the credit account's holder name** |
| 7 | Cdtr | StrtNmOrAdrLine1 | O | 70 | street or P.O. box, no building number |
| 8 | Cdtr | BldgNbOrAdrLine2 | O | 16 | building number |
| 9 | Cdtr | PstCd | D | 16 | postal code, **no country prefix** |
| 10 | Cdtr | TwnNm | D | 35 | town |
| 11 | Cdtr | Ctry | M | 2 | ISO 3166-1 alpha-2 |
| 12–18 | UltmtCdtr | seven elements | **X** ×7 | — | **Ultimate creditor: reserved. Must NOT be filled — and the seven empty separator lines are still sent.** |
| 19 | CcyAmt | Amt | O | 12 incl. `.` | no leading zeros, exactly 2 decimals, `.` separator, **no thousands separator**, range `0.01`–`999999999.99`. Empty means the payer fills it in. |
| 20 | CcyAmt | Ccy | M | 3 | **`CHF` or `EUR` only** |
| 21 | UltmtDbtr | AdrTp | D | 1 | `S`. The group as a whole is optional; used means all its D elements are required. |
| 22 | UltmtDbtr | Name | D | 70 | |
| 23 | UltmtDbtr | StrtNmOrAdrLine1 | O | 70 | not forwarded to the creditor's bank for EUR |
| 24 | UltmtDbtr | BldgNbOrAdrLine2 | O | 16 | |
| 25 | UltmtDbtr | PstCd | D | 16 | |
| 26 | UltmtDbtr | TwnNm | D | 35 | |
| 27 | UltmtDbtr | Ctry | D | 2 | |
| 28 | RmtInf | Tp | M | 4 | `QRR` / `SCOR` / `NON` |
| 29 | RmtInf | Ref | D | — | QRR: exactly 27 numeric. SCOR: 5–25 alphanumeric, `RF`-prefixed. **Empty for NON.** |
| 30 | AddInf | Ustrd | O | 140 | the unstructured message. **`Ustrd` + `StrdBkgInf` ≤ 140 combined.** |
| 31 | AddInf | Trailer | M | 3 | `EPD` |
| 32 | AddInf | StrdBkgInf | **A** | 140 | billing information, Annex D. Shares the 140 budget. Not forwarded with the payment. |
| 33–34 | AltPmtInf | AltPmt | **A** ×0–2 | 100 each | alternative procedures, e.g. eBill. Omitted entirely when unused. |

Lines 1–31 are always present, empty where allowed. Lines 32–34 are status A:
omit them **and their separators**. No trailing newline after the last emitted
line.

Data groups are structural only and are never themselves delivered. If an
optional group is used, all its dependent sub-elements must be filled (§4.1.5).

**The header elements are metadata**: never transmitted with the payment, and
they must not appear in the visible part (§7.2).

## 4. The two check-digit algorithms

**Both are derived, never stored and never typed.** The stored value is the
reference *body*; the check digit is computed at read time.

### QRR — modulo-10 recursive (§2.12.1, Annex B)

Exactly 27 numeric characters: 26 body digits plus one check digit. Must not be
all zeros. Only with a QR-IBAN, only CHF.

```
carry table, indexed by carry:
  in:  0 1 2 3 4 5 6 7 8 9
  out: 0 9 4 6 8 2 7 1 3 5

carry = 0
for each digit d of the 26, left to right:
    carry = TABLE[(carry + d) mod 10]
check  = (10 - carry) mod 10
```

**Test vector:** body `21000000000313947143000901` → check digit **7** → full
reference `210000000003139471430009017`.

### SCOR — ISO 11649, modulo 97-10 (§2.12.2)

5–25 alphanumeric characters: `RF`, two check digits, then up to 21 reference
characters. Only with a regular IBAN. CHF and EUR.

```
generate(body):
  s = body + "RF00"
  replace each letter with its position + 9  (A=10 … Z=35)
  check = 98 - (s as integer mod 97)         , zero-padded to 2
  return "RF" + check + body

validate(ref):
  move the first 4 characters to the end, convert letters as above,
  and the result mod 97 must equal 1
```

**Test vector:** body `539007547034` → **`RF18539007547034`**.

### ⚠ The erratum — do not use the PDF's Example 4

`RF720191230100405JSH0438`, in the PDF's own Annex A, **does not validate**:
mod 97 = 49, not 1. The correct check digits for that body are `RF24`. Verified
computationally.

**Treat the Annex A examples as layout illustrations, not as test vectors.** Use
the two vectors above, plus the PDF's Example 2 serialized payload as the
serializer's golden test.

## 5. What the reference body encodes

Position **P11**, still open, and it needs the bank. The QRR body's leading
digits may be used — *in consultation with the creditor's bank* — as a grouping
criterion for payment receipts (§4.3.2).

This plan's provisional scheme, declared once in `lib/qr/reference.ts`:

```
00000000000000  +  company.seq (4)  +  invoice.seq_no (8)   = 26 digits
```

**Settle it with the bank before the first real QRR bill.** Changing it after
bills are in the wild means two schemes in circulation, and the reference is how
a payment finds its invoice.

## 6. Geometry and typography (§3, §6)

| Item | Spec |
|---|---|
| Payment part | **148 × 105 mm**, DIN A6 landscape, at the **bottom** of the invoice |
| Receipt | **62 × 105 mm**, always to the **left** of the payment part |
| Together | 210 × 105 mm — DIN long, the width of A4 |
| QR code | **46 × 46 mm** always, whatever the version. Scale from vector only. |
| Quiet zone | **5 mm** unprinted border (the ISO minimum is 4 modules; the design spec expands it) |
| Minimum module | **0.4 mm** printed |
| Swiss cross | **7 × 7 mm**, black square with a white cross, centred on the code |
| Section spacing | ≥ 5 mm unprinted between sections |
| Amount blank field | payment part 40 × 15 mm · receipt 30 × 10 mm · 0.75 pt corner marks |
| Payable-by blank field | payment part ≥ 65 × 25 mm · receipt ≥ 52 × 20 mm · 0.75 pt |
| Acceptance point | receipt, ≥ 20 mm high, text right-aligned |
| Paper | white, 80–100 g/m², perforated. **No coated or reflective stock.** Reverse not printed, no advertising. |

**Fonts: Arial, Frutiger, Helvetica or Liberation Sans only.** Black,
sans-serif, no italics, no underline. **Liberation Sans is the one of the four
that is freely redistributable**, which is why phase 2 vendors it.

| Where | Size |
|---|---|
| Payment part headings | 6–10 pt **bold**, always 2 pt smaller than their values. Recommended 8 pt headings / 10 pt values. |
| Title "Payment part" | **11 pt bold** — the one exception |
| Receipt | headings **6 pt bold**, values **8 pt**, title 11 pt bold |
| Alternative procedures line | 7 pt, procedure name bold |

The receipt may save space: a smaller font down to 6 pt, and the street and
building number may be dropped from both addresses.

### The information section, in order (§3.5.4)

1. **Account / Payable to** — the IBAN in **blocks of 4**, then the creditor's
   name and address.
2. **Reference** — QRR in blocks of **2 then 5×5**
   (`21 00000 00003 13947 14300 09017`); SCOR in blocks of **4**.
3. **Additional information** — `Ustrd` **must** be printed. `StrdBkgInf` is
   normally optional to print but **mandatory when it contains personal data**.
   Truncation is marked `...` and must keep personal data visible.
   **Neither is ever printed on the receipt.**
4. **Payable by**, or **Payable by (name/address)** with the blank field when the
   debtor is not in the code.

**Amount on paper** uses a space as the thousands separator and `.` as the
decimal, always two decimals: `CHF 1 590.00`. **In the payload there is no
thousands separator:** `1590.00`. Two formats, both mandated, and a test for
each.

**If a value is absent from the code, its heading must not be printed.** Headings
are fixed literals per language (Annex C) and **must not be reworded** — they are
legal text, like books' statutory line names. Print the country code for a
creditor or debtor outside CH/LI. `c/o` and P.O. box details belong in the
invoice header, not the payment part.

### PDF and on-screen use (§3.7, §3.8)

A PDF QR-bill is valid for e-banking and m-banking, and **not** for counter
payments unless printed to the exact format. Separation lines carry the scissors
symbol or the words "Separate before paying in", **above the line and outside the
payment part**.

Displayed online, the receipt may be omitted, but the full QR-bill must remain
available on request, every visible payment-part value must be shown even on a
small screen, and the payer must be told explicitly that the online payment part
is for e-banking and ERP use.

## 7. The minimal compliant generator — §6, in priority order

This is the build checklist for [phase 2](phase-2-references-qr-and-pdf.md).

1. **Payload serializer** — all 31 base lines in exact order, one consistent line
   ending, empty lines for unused O and X elements, **omission** (not an empty
   line) for unused A elements, no trailing newline, ≤ 997 characters.
2. **Character-set enforcement** — reject anything outside §4.1.1; UTF-8 encode.
3. **Account and reference validation** — 21-character CH/LI IBAN with valid ISO
   13616 check digits; QR-IID detection forcing QRR; regular IBAN taking SCOR or
   NON; QRR only in CHF.
4. **Both check-digit algorithms**, generate and validate, against the vectors in
   §4 above — and **not** the PDF's Example 4.
5. **Amount and currency rules** — CHF/EUR only, `0.01`–`999999999.99`, `.`
   decimal, two decimals, no leading zeros, no thousands separator in the code;
   an empty amount means the hand-fill field is drawn.
6. **Structured address only** — `AdrTp = S`; name, postal code, town and country
   always filled for the creditor, and for the debtor whenever the group is used;
   the length caps of §3.
7. **QR rendering** — ISO 18004, ECC M, smallest fitting version, scaled to
   exactly 46×46 mm from vector, 7×7 mm Swiss cross, ≥ 5 mm quiet border.
8. **Payment part and receipt layout** — the geometry and typography of §6 above,
   the Annex C literals exact, the block formats, the blank fields at their
   mandated sizes, the separation hint for PDF output.
9. **The 140-character shared budget** — `len(Ustrd) + len(StrdBkgInf) ≤ 140`,
   enforced at validation time even while we emit no `StrdBkgInf`.
10. **Additional-information printing rules** — always print `Ustrd`; print
    `StrdBkgInf` only when it holds personal data, and better, keep personal data
    out of it entirely; neither on the receipt.
11. **Notification bills** — amount exactly `0.00` plus the exact capitalised
    phrase per language. **Out of scope for v1** and listed so the omission is a
    decision: `NICHT ZUR ZAHLUNG VERWENDEN` / `NE PAS UTILISER POUR LE PAIEMENT` /
    `NON UTILIZZARE PER IL PAGAMENTO` / `DO NOT USE FOR PAYMENT` /
    `BETG DUVRAR PER IL PAJAMENT`, applied identically in the code, the payment
    part and the receipt.
12. **Billing information and alternative procedures** — Annex D `//S1` syntax
    and the two `AltPmt` lines. **Out of scope** (P5, P14). The budget check in
    item 9 exists anyway.

Out of scope for a generator and still worth reading before touching payments:
§5's pain.001 and pacs.008 mapping, §7's reader-side checks, and SIX's separate
*Processing rules for QR-bills*, which nobody here has opened.

## 8. How a bill is proven correct

Three tiers, and **the first is not sufficient**.

**Tier 1 — automated, every commit.** The two check-digit vectors; the PDF's
Example 2 payload byte-for-byte; IBAN check digits; every row of the combination
matrix rejected; the 997-character and 140-character limits; a rendered PDF's
page box measured at 210 × 297 mm and its QR box at 46 × 46 mm.

**Tier 2 — the SIX validation portal, by hand, before the first real bill.**
`https://validation.iso-payments.ch/gp/qrrechnung/validation/`. **It requires an
account**, so this cannot be automated and cannot be a CI gate. Upload one bill
of each shape: CHF + QRR, CHF + SCOR, EUR + SCOR, and NON. The Style Guide
(v1.1, 19 December 2025) ships a grid sheet for checking the printed geometry by
eye.

**Tier 3 — a real scanner.** Two different banking apps, on a printed page and
on a screen. A payload that validates and does not scan is still a bill nobody
can pay.

**Record tier 2 and tier 3 in `apps/billing/docs/backend.md`, stamped with the
commit they were true for.** A verification claim that does not name the file
state it describes silently becomes a claim about code that no longer exists.

And the standing rule, pointed at this phase: **an absence is only evidence if
you know your instrument could have seen the presence.** A QR code that "looks
fine" in a screenshot has been checked by no instrument at all.
