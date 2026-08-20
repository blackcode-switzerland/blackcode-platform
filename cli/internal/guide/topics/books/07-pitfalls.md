# Books pitfalls — the mistakes specific to this app

The platform pitfalls list (`bk guide platform/pitfalls`) covers the mistakes
that bite everywhere. These are the ones that only happen here, and most of them
were found by driving the CLI rather than by reading it.

Related commands: `bk books worklist`, `bk books account list`, `bk books account
create`, `bk books entity edit`, `bk books tax-params show`, `bk books opening
set`, `bk books exercice close`, `bk books rule deactivate`, `bk books bilan`.

**1. Taking the default book.** Nearly every command falls back to the first
book and its latest year. A workspace with three books will answer confidently
about whichever sorts first. Pass `--entity` and `--exercice` in anything
scripted. The worklist is the dangerous one: scoped to one book, it reports
"nothing to do" while another book is full of work.
→ `bk guide books/money-in`

**2. Assuming a new book is VAT-registered.** It is not, and while it is not the
tax snapshot serves NO VAT position however the entries are booked. Nothing
warns you; the field is simply absent. `bk books entity edit --vat-registered`
turns it on, and needs the method and period with it.
→ `bk guide books/starting-a-book`

**3. Expecting a tax picture without parameters.** `configured: false` is a real
answer, not a bug and not a placeholder to work around. Nothing here may assume
a canton. Set them once per book.
→ `bk guide books/starting-a-book`

**4. Typing an account number that does not exist in THAT book.** Every book has
its own chart, and the template is 24 accounts, not every account a company
keeps. A posting to an account the chart lacks is refused now — but if you meet
that refusal, check whether the number is a typo before adding the account.
→ `bk guide books/entries`

**5. Booking a salary as two entries.** It is one economic event with three or
more sides. Use repeated `--debit` and `--credit`. Splitting it into two
two-line entries makes the journal say two things happened.
→ `bk guide books/entries`

**6. Trying to type openings for a later year.** Only a book's FIRST year is
typed. Every later year's openings are PRODUCED by closing the year before it.
If `opening set` refuses, the answer is almost always `exercice close`, not a
workaround.
→ `bk guide books/year-end`

**7. Treating a refusal as a failure to route around.** Nearly every refusal
here is the product working: a filed year that will not reopen, a posted entry
that will not edit, an unbalanced statement that will not import. Each carries a
`code` and a `suggestion` — read the suggestion. It usually names the command
that actually does what you want.

**8. Correcting by trying to undo.** There is no un-post, no edit, no delete.
Where you expect an undo, the answer is a new record: a reversing entry, a
second analysis, a fresh verdict.

**9. Leaving a wrong rule running.** A rule taught against a bad fragment keeps
matching every future import. `rule deactivate` stops it; the entries it already
explained keep their explanation.
→ `bk guide books/money-in`

**10. Believing a piece was ingested because the command exited 0.** A document
that fails validation LANDS, staged and flagged, on purpose. Check
`needs_review` and `validation` on the result rather than the exit code.
→ `bk guide books/documents`

**11. Sending a PDF to `piece ingest`.** It takes an already-extracted JSON
record. There is no upload route in this app at all.
→ `bk guide books/documents`

**12. Reading a number out of a stored analysis and assuming it is current.** A
`based_on` snapshot is what was true when the answer was filed and is never
recomputed. Re-ask and file a new record.
→ `bk guide books/statements`
