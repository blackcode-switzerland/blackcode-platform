<!--
VENDORED 2026-09-17 from b-mockups/bbilling/research/QR-BILL-TECHNICAL-SPEC.md, so a
builder does not need the mockups repository (docs/billing-app-plan/qr-bill.md,
"Provenance"). Order of authority: the SIX PDF, then this extraction, then qr-bill.md.
-->

> **Read this box first. Four corrections and one decision, found while building
> `apps/billing/lib/qr/` (ticket #84) and checked against the v2.4 PDF itself.**
>
> 1. **Example 2's creditor name.** The v2.4 PDF (Table 18, page 52) prints
>    `Max Muster & Söhne (sample company)`. The extraction below dropped the
>    parenthesis. §5 below has been corrected to the PDF;
>    `lib/qr/spec-examples.ts` carries it, and the golden test passes on it.
> 2. **§6 item 2 says "reject or transliterate".** This app **rejects, never
>    transliterates** (`lib/qr/charset.ts`): a creditor name that no longer
>    matches the account holder is a returned payment.
> 3. **The SCOR body is at most 21 characters**, because 25 is the whole
>    reference including `RF` and its check digits (§2.3 below states this
>    correctly). Phase 1's code and CHECK had put the 25 on the body; migration
>    0008 corrected both.
> 4. **Annex C** is only summarised in §3.5 below. The complete five-language
>    table (PDF page 62) is in `lib/qr/labels.ts` and `labels.test.ts`.
>
> **The decision the standard leaves open:** when line 32 (billing information)
> is unused but line 33 (an alternative procedure) is used, this app keeps line 32
> in position, empty. `swissqrbill` drops it. See `lib/qr/payload.ts`. v1 emits
> neither line, so the case is unreachable today.
>
> Verified computationally here, beyond the two vectors in §2: the QR references
> of Annex A examples 1 and 2, and the IBANs of examples 1–3 (`reference.test.ts`).

# Swiss QR-Bill — Implementation-Ready Technical Spec

**Ground truth:** SIX Interbank Clearing Ltd, *Swiss Implementation Guidelines for the QR-bill*, Version 2.4, 24.02.2026, valid from 14 November 2026 (70 pp, `ig-qr-bill-v2.4-en.pdf` in this folder). All section references (§) are to that document. Extends `01-qr-bill-standard.md`; this document supersedes it where they differ.

**v2.4 headline changes** (vs v2.3, per revision history + General notes):
- QR-IBAN and QR reference are now **exclusively for CHF** (§2.8, 2.10, 2.12). For EUR, only IBAN+SCOR or IBAN+unstructured message remain possible (euroSIC discontinuation; EUR QR-bills settle as SEPA Credit Transfers after Nov 2027 at the latest, and transfer of ultimate-debtor address / supplementary data is **not guaranteed** for EUR).
- Structured address is now **obligatory** (address type "S" only; the old combined-address option "K" is gone from the data table).
- Romansh added as fifth correspondence language (from 01.01.2026).
- SIX (previously Swico) now owns the "Billing information" syntax definition (Annex D).
- Version 2.3 remains valid until November 2027 (parallel validity window).

---

## 1. Swiss QR Code — data container

### 1.1 Encoding fundamentals (§4.1, §6)

| Property | Value |
|---|---|
| QR standard | ISO 18004, error correction level **M** (~15%), fixed (§2.5, §6.1) |
| Encoding | UTF-8, restricted character set (below) |
| Max payload | **997 characters** including separators (§6.2) |
| Resulting max QR version | Version 25, 117×117 modules (at level M, binary coding) |
| Generation rule | Generate in the **smallest version** that fits, then scale to 46×46 mm (§6.4) |
| Element separator | CR+LF **or** LF alone — one style consistently per document; separator after the final element is **eliminated** (§4.1.4) |
| Header | `SPC` / `0200` / `1` (fixed; see element table) |

**Character set (§4.1.1)** — permitted Unicode codepoints:
- Basic Latin U+0020–U+007E
- Latin-1 Supplement U+00A0–U+00FF
- Latin Extended-A U+0100–U+017F
- Plus exactly: `Ș` U+0218, `ș` U+0219, `Ț` U+021A, `ț` U+021B, `€` U+20AC

**Line definitions used in the table (§4.1.2):** *general* = full character set above · *numeric* = 0–9 · *alphanumeric* = A–Z a–z 0–9 · *decimal* = 0–9 plus "." decimal separator.

**Line lengths (§4.1.3):** stated lengths are maxima. Padding with blanks up to max length is **not permitted**.

### 1.2 Status codes (§4.2.1, Table 7)

| St. | Meaning | Rule |
|---|---|---|
| **M** | Mandatory | Line must be delivered filled |
| **D** | Dependent | Must be filled if the superordinate data group is filled |
| **O** | Optional | Line must be **delivered**, but may be empty |
| **A** | Additional | Line **omitted entirely** if unused — no trailing empty line. Not relevant for payment processing; errors in A-lines must not cause rejection |
| **X** | Do not fill | Must **not** be filled, but the separator line must still be sent |

Data groups (blue rows in Table 8) are structural only — they are never themselves delivered in the QR code. If an *Optional* data group is used, all its *Dependent* sub-elements must be filled (§4.1.5).

### 1.3 Full payload — all 34 lines, in exact order (§4.2.2, Table 8)

| # | Path | Element | St. | Type / limit | Content & validation |
|---|---|---|---|---|---|
| 1 | Header | QRType | M | fixed 3, alphanum | `SPC` (Swiss Payments Code) |
| 2 | Header | Version | M | fixed 4, numeric | `0200`. First 2 digits = main version, last 2 = sub-version. Only `0200` permitted in master version 02; sub-versions enabled from master version 03 |
| 3 | Header | Coding | M | fixed 1, numeric | `1` = UTF-8 restricted to Latin set (§4.1.1) |
| 4 | CdtrInf | IBAN | M | fixed 21, alphanum | IBAN **or QR-IBAN** of creditor. No spaces. **Only CH or LI country codes permitted** |
| 5 | CdtrInf.Cdtr | AdrTp | M | fixed 1, alphanum | `S` (structured) — only permitted value |
| 6 | CdtrInf.Cdtr | Name | M | max 70, general | Creditor name/company — **must match the account holder name** of the credit account. First name optional but recommended |
| 7 | CdtrInf.Cdtr | StrtNmOrAdrLine1 | O | max 70, general | Street / P.O. box (no building number) |
| 8 | CdtrInf.Cdtr | BldgNbOrAdrLine2 | O | max 16, general | Building number |
| 9 | CdtrInf.Cdtr | PstCd | D* | max 16, general | Postal code, **without** country prefix. *Always required in practice — structured address is obligatory |
| 10 | CdtrInf.Cdtr | TwnNm | D* | max 35, general | Town. *Always required in practice |
| 11 | CdtrInf.Cdtr | Ctry | M | fixed 2 | ISO 3166-1 alpha-2 country code |
| 12–18 | UltmtCdtr | AdrTp, Name, StrtNmOrAdrLine1, BldgNbOrAdrLine2, PstCd, TwnNm, Ctry | X ×7 | — | **Ultimate creditor: reserved for future use. Entire group must NOT be filled** — but the 7 empty separator lines must be sent |
| 19 | CcyAmt | Amt | O | decimal, max 12 incl. "." | Amount: no leading zeros, exactly 2 decimal places, "." as decimal separator, **no thousands separator in the code**. Range 0.01–999 999 999.99. Empty = payer fills in by hand |
| 20 | CcyAmt | Ccy | M | fixed 3, alphanum | ISO 4217. **Only `CHF` and `EUR`** |
| 21 | UltmtDbtr | AdrTp | D | fixed 1, alphanum | `S` only. Group "Ultimate debtor" = *Payable by* — optional as a whole; if used, all D elements required |
| 22 | UltmtDbtr | Name | D | max 70, general | Debtor name/company |
| 23 | UltmtDbtr | StrtNmOrAdrLine1 | O | max 70, general | Street / P.O. box. (Not forwarded to creditor's bank for EUR payments) |
| 24 | UltmtDbtr | BldgNbOrAdrLine2 | O | max 16, general | Building number |
| 25 | UltmtDbtr | PstCd | D | max 16, general | Postal code, without country prefix |
| 26 | UltmtDbtr | TwnNm | D | max 35, general | Town |
| 27 | UltmtDbtr | Ctry | D | fixed 2 | ISO 3166-1 country code |
| 28 | RmtInf | Tp | M | max 4, alphanum | `QRR` \| `SCOR` \| `NON`. **QRR mandatory with QR-IBAN; SCOR or NON with regular IBAN** |
| 29 | RmtInf | Ref | D | see §2 below | QRR: exactly 27 numeric. SCOR: 5–25 alphanumeric starting `RF`. **Must be empty for NON.** Banks are case-insensitive when processing |
| 30 | RmtInf.AddInf | Ustrd | O | max 140, general | Unstructured message (payment purpose). **Ustrd + StrdBkgInf combined ≤ 140 chars** |
| 31 | RmtInf.AddInf | Trailer | M | fixed 3, alphanum | `EPD` (End Payment Data) |
| 32 | RmtInf.AddInf | StrdBkgInf | A | max 140, general | Billing information (Annex D syntax, §4 below). Counts toward the shared 140-char budget with line 30. Not forwarded with the payment |
| 33–34 | AltPmtInf | AltPmt | A ×0–2 | max 100 each, alphanum | Alternative procedure parameters (e.g. eBill). Max two occurrences. Omitted entirely when unused |

**Serialization rules recap:** lines 1–31 are always present (empty where allowed); line 32 and lines 33–34 are status A — omit them *and their separators* when unused; no trailing newline after the last emitted line.

**Reading-side checks (§7.1)** — a compliant reader must validate before processing: QRType/Version/Coding/Currency against valid values; general specs of §4.1; amount syntax; and the permitted account↔reference-type combinations (IBAN↔SCOR/NON, QR-IBAN↔QRR). **Header elements (QRType, Version, Coding) are metadata: never transmitted with the payment and must not appear in the visible part (§7.2).**

---

## 2. Account and reference system

### 2.1 QR-IBAN vs standard IBAN (§2.7–2.10)

| | Standard IBAN | QR-IBAN |
|---|---|---|
| Structure | ISO 13616, CH/LI only in QR-bills, 21 chars | Identical ISO 13616 structure |
| IID (positions 5–9) | Regular bank IID | **QR-IID: 30000–31999** (exclusively reserved; one QR-IID per legally independent institution) |
| Reference type | `SCOR` or `NON` | **`QRR` only** (and QRR requires QR-IBAN — an IBAN cannot carry a QRR) |
| Currencies | CHF and EUR | **CHF only (v2.4)** |
| Direction | Normal account | **Incoming payments only** — never for debits |

Detection rule for an implementer: parse positions 5–9 of the (CH/LI) IBAN; if 30000 ≤ IID ≤ 31999 it is a QR-IBAN → reference type must be QRR.

### 2.2 QR reference (QRR) — §2.12.1, Annex B

- Exactly **27 numeric characters**: 26 payload digits + 1 check digit (position 27).
- Must **not** consist exclusively of zeros.
- Only with QR-IBAN, only CHF.
- First digits may be used (in consultation with the creditor's bank) as a grouping criterion for payment receipts (§4.3.2).
- Check digit: **modulo 10 recursive**.

**Modulo-10 recursive algorithm.** Use the carry table (this is the standard Swiss ESR table; the PDF renders it only as an image, Figure 21, but the worked example below reproduces the PDF's Figure 22 trace exactly):

```
carry:      0  1  2  3  4  5  6  7  8  9
next-carry: 0  9  4  6  8  2  7  1  3  5
```

Pseudocode:

```
carry = 0
for each digit d in the 26-digit reference (left to right):
    carry = TABLE[(carry + d) mod 10]
check_digit = (10 - carry) mod 10
```

**Worked example (= PDF Annex B example, verified computationally):**
Input `21 00000 00003 13947 14300 0901` (26 digits)

| pos | digit | carry in | carry out |
|---|---|---|---|
| 1 | 2 | 0 | 4 |
| 2 | 1 | 4 | 2 |
| 3 | 0 | 2 | 4 |
| 4 | 0 | 4 | 8 |
| 5 | 0 | 8 | 3 |
| 6 | 0 | 3 | 6 |
| 7 | 0 | 6 | 7 |
| 8 | 0 | 7 | 1 |
| 9 | 0 | 1 | 9 |
| 10 | 0 | 9 | 5 |
| 11 | 0 | 5 | 2 |
| 12 | 3 | 2 | 2 |
| 13 | 1 | 2 | 6 |
| 14 | 3 | 6 | 5 |
| 15 | 9 | 5 | 8 |
| 16 | 4 | 8 | 4 |
| 17 | 7 | 4 | 9 |
| 18 | 1 | 9 | 0 |
| 19 | 4 | 0 | 8 |
| 20 | 3 | 8 | 9 |
| 21 | 0 | 9 | 5 |
| 22 | 0 | 5 | 2 |
| 23 | 0 | 2 | 4 |
| 24 | 9 | 4 | 6 |
| 25 | 0 | 6 | 7 |
| 26 | 1 | 7 | 3 |

Final carry = 3 → check digit = (10 − 3) mod 10 = **7** → full reference `210000000003139471430009017` (this is the reference used in the PDF's own Example 2).

### 2.3 Creditor Reference (SCOR, ISO 11649) — §2.12.2

- 5–25 **alphanumeric** characters: `RF` + 2 check digits (positions 3–4) + up to 21 reference characters.
- Only with a regular IBAN (never QR-IBAN); CHF **and** EUR.
- Check digits: **modulo 97-10** (same family as IBAN check digits).

**Generation algorithm:**
1. Take the reference body (e.g. `539007547034`).
2. Append `RF00` → `539007547034RF00`.
3. Replace letters with numbers (A=10 … Z=35): R=27, F=15 → `539007547034271500`.
4. Check digits = 98 − (that number mod 97). Here: 539007547034271500 mod 97 = 80 → 98 − 80 = **18**.
5. Result: `RF18539007547034` (this is the reference used in the PDF's own Examples 5 and 6).

**Validation algorithm:** move the first 4 chars to the end, convert letters as above, and the number mod 97 must equal **1**. Check: `539007547034` + `RF18` → `539007547034271518` mod 97 = 1 ✓

> ⚠️ **PDF erratum worth knowing:** the SCOR reference in the PDF's Example 4, `RF720191230100405JSH0438`, does **not** validate (mod 97 = 49, not 1; correct check digits for that body would be RF24). Verified computationally. Treat Annex A examples as layout illustrations, not as check-digit test vectors — use `RF18539007547034` and the QRR example above as test vectors instead.

### 2.4 NON

No reference. `Ref` (line 29) must be empty. Only with regular IBAN. The unstructured message (line 30) carries any free-text purpose.

### 2.5 Permitted combination matrix (§7.1, §4.3.2)

| Account | Reference type | Currencies | Valid? |
|---|---|---|---|
| QR-IBAN | QRR | CHF only | ✔ (the only valid QR-IBAN combination) |
| QR-IBAN | SCOR / NON | — | ✘ reject |
| IBAN | SCOR | CHF, EUR | ✔ |
| IBAN | NON | CHF, EUR | ✔ |
| IBAN | QRR | — | ✘ reject |

---

## 3. Physical layout (§3, §6)

### 3.1 Geometry

| Item | Spec |
|---|---|
| Payment part | DIN-A6 landscape, **148 × 105 mm**, positioned at the **bottom edge** of the invoice (or separated by perforation) |
| Receipt | **62 × 105 mm**, always to the **left** of the payment part; together 210 × 105 mm (DIN long = width of A4) |
| Perforation | Mandatory between invoice and payment part, and between payment part and receipt (paper form). Incorrect separation can cause rejection/costs |
| Paper | White, 80–100 g/m², perforated; recycled/FSC/TCF allowed; **no coated or reflective stock**; reverse side must not be printed; no advertising |
| Section spacing | Blank zones between sections ≥ 5 mm height/width, unprinted (receipt: may be reduced in favour of the acceptance-point section) |
| Swiss QR Code print size | Always **46 × 46 mm** (excluding quiet zone), regardless of QR version; scale from vector graphics only |
| Quiet zone | ISO minimum 4 modules (≥1.6 mm); design spec expands this to **5 mm unprinted border** around the code |
| Minimum module size | **0.4 mm** when printing |
| Swiss cross logo | **7 × 7 mm**, black square + white cross, overlaid at centre (file from SIX Download Centre) |
| Amount blank field (payment part) | 40 × 15 mm, black corner marks, 0.75 pt line |
| Amount blank field (receipt) | 30 × 10 mm, 0.75 pt |
| Payable-by blank field (payment part) | ≥ 65 × 25 mm, 0.75 pt |
| Payable-by blank field (receipt) | ≥ 52 × 20 mm, 0.75 pt |
| Acceptance point section (receipt) | ≥ 2 cm high, text right-aligned |

### 3.2 Typography (§3.4)

- Fonts: **Arial, Frutiger, Helvetica, Liberation Sans only**, black, sans-serif. No italics, no underline.
- Payment part: headings 6–10 pt bold, always 2 pt smaller than their values; recommended 8 pt headings / 10 pt values. Title "Payment part" = **11 pt bold** (the only exception).
- Alternative procedures line: **7 pt**, procedure name in bold.
- Receipt: headings **6 pt bold**, values **8 pt**; title "Receipt" 11 pt bold.
- Receipt space savings allowed: smaller font (min 6 pt), street/building number may be omitted from creditor and debtor addresses.

### 3.3 Section structure & printing rules (§3.5, §3.6)

Payment part has 5 sections: **Title** ("Payment part") · **Swiss QR Code** · **Amount** · **Information** · **Further information**. Receipt has 4: Title · Information · Amount · Acceptance point (no QR, no further-info).

Information section order and formatting (§3.5.4, Table 4):
1. **Account / Payable to** — IBAN printed in blocks of 4 (5×4 + 1 final char), then creditor name and address.
2. **Reference** — QRR printed in blocks: 2 chars then 5×5 (`21 00000 00003 13947 14300 09017`); SCOR printed in blocks of 4.
3. **Additional information** — Ustrd (must be printed) + StrdBkgInf (printing normally optional — but **mandatory to print if it contains personal data** under data-protection law). Truncation marked with `...`, ensuring personal data remain displayed. **Never printed on the receipt.**
4. **Payable by** / **Payable by (name/address)** — the latter heading + blank field when the debtor is not in the code.

Amount display: printed with space as thousands separator and "." decimal, always 2 decimals (`CHF 1 590.00`) — note this differs from the in-code format (no thousands separator). If a value is absent from the QR code, its heading must not be printed; headings are fixed literals per language (Annex C) and must not be altered.

Country code should be printed for creditor/debtor domiciled outside CH/LI. c/o and P.O. box details are irrelevant to the payer — put them in the invoice header, not the payment part.

### 3.4 PDF and online use (§3.7, §3.8)

- PDF QR-bills: valid only for e-/m-banking payments, not counter payments unless printed to exact format. Separation lines must carry the scissors symbol or the text "Separate before paying in" above the line, outside the payment part.
- Online-only display: receipt may be omitted; full QR-bill must remain available on request (for counter/postal payment); all visible payment-part data must be shown even on small screens; payer must be explicitly told the online payment part is for e-banking/ERP use only.

### 3.5 Languages (§3.2, Annex C)

German, French, Italian, Romansh, English — issuer's choice. Key literals (full table in Annex C): *Payment part / Receipt / Account / Payable to / Reference / Additional information / Payable by / Payable by (name/address) / Currency / Amount / Acceptance point / Separate before paying in*. "Schalterzahlung" contexts at post offices are always German.

### 3.6 "DO NOT USE FOR PAYMENT" notification bills (§4.4)

For notification-only QR-bills: Amount = **`0.00`** (never blank, never letters), Additional information = the exact capitalized phrase in the correspondence language (`NICHT ZUR ZAHLUNG VERWENDEN` / `NE PAS UTILISER POUR LE PAIEMENT` / `NON UTILIZZARE PER IL PAGAMENTO` / `DO NOT USE FOR PAYMENT` / `BETG DUVRAR PER IL PAJAMENT`), applied identically in QR code, payment part and receipt. The 0.00 amount guarantees eBill conversion produces a notification that cannot be released for payment.

---

## 4. Billing information — SIX syntax (Annex D, Version 1.2)

Line 32 (`StrdBkgInf`), max 140 chars **shared with** the unstructured message. Coding always starts `//` + two-character syntax identifier. `S1` = SIX syntax v1.x (previously Swico; SIX took ownership in v2.4; latest version published on www.qr-rechnung.ch). Billing data **must not include personal data** (§4.3.3). Data are not forwarded with the payment — they are for the recipient's accounts-payable automation.

### 4.1 Tags

| Tag | Meaning | Example | Notes |
|---|---|---|---|
| `/10/` | Invoice number | `/10/10201409` | Free text |
| `/11/` | Voucher (invoice) date | `/11/190512` | YYMMDD. Reference date for /40/ terms |
| `/20/` | Customer reference | `/20/140.000-53` | Free text; identifies invoice at the customer |
| `/30/` | VAT/UID number | `/30/106017086` | Numeric UID only — strip `CHE-` prefix, dots, `MWST/TVA/IVA/VAT` suffix. Enter even if other VAT fields are omitted; if multiple UIDs, first one |
| `/31/` | VAT date | `/31/180508` or `/31/181001190131` | Service date, or start+end (YYMMDDYYMMDD). Omit if several services with different dates |
| `/32/` | VAT details | `/32/7.7` or `/32/8:1000;2.5:51.80;7.7:250` | Single rate applied to full amount, **or** list `rate:netAmount` pairs (`;`-separated, `:` between rate and net). Net amounts + their VAT must total the QR amount. Refers to amount before discount |
| `/33/` | VAT import tax | `/33/7.7:16.15` | Pure VAT amount(s) with rate(s) for goods imports |
| `/40/` | Payment conditions | `/40/0:30` or `/40/2:10;0:60` | `discount%:days` pairs. **`0:n` = net payable in n days — always include it**, otherwise payment software cannot compute a due date. Due date = /11/ date + n days |

### 4.2 Syntax rules (Annex D, Table 29)

- Tags in **ascending order**; each tag at most once; empty tag = omitted tag (omit it).
- Value length per tag not directly limited (only by the 140-char total).
- Escape `/` as `\/` and `\` as `\\` inside values.
- Decimal separator `.`; numbers < 1 get a leading zero (`0.3`).
- Dates `YYMMDD`. List separator `;`, rate:amount separator `:`.
- Amount and currency are **not** repeated in billing info (they live in dedicated QR lines).

### 4.3 Real examples (from the PDF, Table 31)

```
//S1/10/10201409/11/190512/20/1400.000-53/30/106017086/31/180508/32/7.7/40/2:10;0:30
```
Invoice 10201409 of 12.05.2019, customer ref 1400.000-53, UID CHE-106.017.086, service date 08.05.2018, VAT 7.7% on the whole amount, 2% discount ≤10 days, net 30 days.

```
//S1/10/10104/11/180228/30/395856455/31/180226180227/32/3.7:400.19;7.7:553.39;0:14/40/0:30
```
Multi-rate: 3.7% on 400.19 net + 7.7% on 553.39 net + 0% on 14.00 → gross total 1025.00 must equal the QR amount. Net 30 days.

```
//S1/10/4031202511/11/180107/20/61257233.4/30/105493567/32/8:49.82/33/2.5:14.85/40/0:30
```
With import VAT: 8% on 49.82 net, plus 14.85 pure import VAT at 2.5% → total 68.65.

```
//S1/10/X.66711\/8824/11/200712/20/MW-2020-04/30/107978798/32/2.5:117.22/40/3:5;1.5:20;1:40;0:60
```
Escaped `/` in invoice number `X.66711/8824`; staged discounts 3%/5d, 1.5%/20d, 1%/40d, net 60 days.

### 4.4 ⚠️ VAT rate flag

**The PDF does not state current Swiss VAT rates anywhere.** All Annex D examples use **pre-2024 rates (8%, 7.7%, 3.7%, 2.5%)** — they are syntax illustrations only, not rate authority. Current rates since 01.01.2024 — **8.1% standard, 2.6% reduced, 3.8% special (lodging)** — come from prior project context and remain **unverified against estv.admin.ch in this pass** (gap #4 of `01-qr-bill-standard.md` stays open). b/billing must source live rates from ESTV, never from spec examples.

### 4.5 Alternative procedures (lines 33–34; §3.5.5)

Max 2 elements, 100 alphanumeric chars each. Format: short procedure name, then the chosen sub-element separator, then procedure-specific data (e.g. `eBill/B/simon.muster@example.com` from PDF Example 2). Printed at 7 pt, name bold; ~90 chars fit on a printed line — truncate with `…` but personal data must remain fully displayed. Content is defined by the procedure provider, agreed with SIX (Annex D process); current procedures listed on the SIX QR-bill page.

---

## 5. Complete serialized payload example (PDF Example 2, QRR + billing info + eBill)

```
SPC
0200
1
CH4431999123000889012
S
Max Muster & Söhne (sample company)
Musterstrasse
123
8000
Seldwyla
CH







1949.75
CHF
S
Simon Muster
Musterstrasse
1
8000
Seldwyla
CH
QRR
210000000003139471430009017
Order from 15.10.2020
EPD
//S1/10/1234/11/201021/30/102673386/32/7.7/40/0:30
eBill/B/simon.muster@example.com
```

(7 empty lines = the never-filled Ultimate creditor block; empty line before `1949.75` would not exist — amount is filled here. Note: lines 32–34 present because used; when unused they and their separators disappear entirely. No newline after the final line.)

---

## 6. Minimal spec-compliant generator — MUST list, by priority

1. **Payload serializer**: emit all 31 base lines in exact Table-8 order, single consistent line-ending (LF or CRLF), empty lines for unused O/X elements, omission (not empty lines) for unused A elements (32–34), no trailing newline, total ≤ 997 chars.
2. **Character-set enforcement**: reject or transliterate anything outside §4.1.1 (Basic Latin, Latin-1 Supplement, Latin Extended-A, Ș ș Ț ț, €); UTF-8 encode.
3. **Account/reference validation**: 21-char CH/LI IBAN with valid ISO 13616 check digits; QR-IID detection (IID 30000–31999) → force QRR; regular IBAN → SCOR or NON; QRR only in CHF.
4. **Check-digit implementations**: modulo-10 recursive (generate + validate, 27-digit QRR, not all zeros) and modulo-97-10 (generate + validate, `RF`-prefixed SCOR ≤25 chars). Use §2.2/§2.3 test vectors.
5. **Amount/currency rules**: CHF/EUR only; 0.01–999 999 999.99; "." decimal, 2 decimals, no leading zeros, no thousands separator in code; empty amount → hand-fill fields on the printed part.
6. **Structured address only**: AdrTp `S`; Name, PstCd, TwnNm, Ctry always filled for creditor (and for debtor when the group is used); field length caps (70/70/16/16/35/2).
7. **QR rendering**: ISO 18004, ECC level M, smallest fitting version, binary mode, module ≥0.4 mm, scaled to exactly 46×46 mm from vector, 7×7 mm Swiss cross overlay, ≥5 mm quiet border.
8. **Payment part + receipt layout**: 148×105 + 62×105 mm geometry, five/four sections, fixed headings in one of the 5 languages (Annex C literals, exact), correct fonts/sizes, IBAN in 4-blocks, QRR in 2+5×5 blocks, SCOR in 4-blocks, amount formatting with space thousands separator, blank hand-fill boxes at mandated sizes when amount/debtor absent, scissors/separation hint for PDF output.
9. **140-char shared budget**: enforce len(Ustrd) + len(StrdBkgInf) ≤ 140 at validation time.
10. **Additional-information printing rules**: always print Ustrd; print StrdBkgInf only when it contains personal data (better: keep personal data out of it entirely — the spec requires billing data to contain none); never print either on the receipt.
11. **Notification bills**: support the `0.00` + exact "DO NOT USE FOR PAYMENT" literal pattern per language.
12. *(Optional but cheap)* Billing-info builder for SIX `//S1` syntax with tag ordering, escaping, and the `/40/0:n` due-date rule; alternative-procedures passthrough (2×100 chars).

**Out of scope for a generator, but required reading for the payment side**: §5 pain.001/pacs.008 mapping, §7 reader-side checks, and the separate *Processing rules for QR-bills* document (still unopened — gap #2 of the research notes remains).

---

## 7. Extraction caveats & known gaps

- **Figures are images** — not OCR-able by the extraction used here: Figure 21 (check-digit matrix) reconstructed from the standard ESR table and verified against the PDF's own worked example and Example 2's reference; all layout figures (4–20) conveyed via the surrounding text, which carries the normative dimensions anyway.
- **PDF erratum**: Example 4's SCOR reference fails modulo-97 validation (see §2.3).
- Gaps #2–#6 from `01-qr-bill-standard.md` (processing rules doc, OR invoice-field law, ESTV rate confirmation, library verification, legal-form differences) remain open — outside this PDF's scope.
