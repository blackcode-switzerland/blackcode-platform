# b/billing — imported history

The bills issued before this app existed live here as an **archive**: browsable,
filterable, and never edited. You bring them in by mapping an export yourself
and importing the rows.

Related commands: `bk billing history import`, `bk billing history list`,
`bk billing history show`.

## An archive, not more invoices

An imported bill keeps the number it was issued with. That number is in its own
namespace: it never enters an issuing company's sequence, nothing joins it to a
native invoice, and it is **not unique** — two old systems and two companies can
each have used the same one. So a row is addressed by its **#number**, the first
column of `history list`, and never by the historical number.

A row is written once and read forever. There is no edit and no delete, and the
database refuses both even to its owner. If a question about a row gets
answered later, the answer is recorded beside it — never by rewriting it.

## You map, the app stores

There is no importer here and no mapping engine. Read the export, decide what
each bill means, and write one row per bill:

```
bk billing history import --file rows.json
cat rows.json | bk billing history import --file -
```

`bk billing history import --help` shows the row shape. Four things about it
cause most refusals:

- **`total` is a string**, `"3240.00"`. A JSON number is refused: it has already
  been through a floating-point value by the time it arrives.
- **`source_ref` is stored exactly as given** — not trimmed, not reformatted. It
  is the only way back to the old system, and a tidied id no longer matches it.
- **A key the row shape does not have is refused.** A misspelled field would
  otherwise vanish silently, taking its value with it.
- **`company` is a slug in this workspace.** An issuing entity you had to guess
  is still one of them — with the guess written in the flag.

Sources, statuses and the per-import row limit come from
`bk meta --app-server billing`, not from this page.

## Say what you could not resolve

When a row is ambiguous, do not guess quietly. Put it in `import_flag`, in words,
in **both** languages:

```
"import_flag": {
  "en": "Possible duplicate of INV-0293 (migration window).",
  "fr": "Doublon possible avec INV-0293 (période de migration)."
}
```

Both or neither: a flag in one language is invisible to everyone reading the
other, and a hidden warning is not a warning. A flag is shown on every surface
and **never cleared** — resolving the question does not change the fact that the
answer was once inferred.

`bk billing history list --flagged` lists the rows that still need a person.

## All or nothing, and a repeat is a refusal

One import is one transaction. Every row is checked and **every** problem comes
back at once, each naming its row and field; if anything is refused, nothing is
written. Fix the file and import all of it again.

A row whose source and source ref are already in the archive refuses the import
with a conflict that names the #number it already has. It is not skipped: if the
export now says something different about a bill that was already imported, a
person should look. So importing the same file twice changes nothing and tells
you exactly which rows were there. A larger export is several imports, each of
which lands whole or not at all.

## Where the PDF is

`drive_path` is the archived PDF's path or id on Google Drive. The app stores the
reference, never the file, and refuses a link into this platform's own file
store. Leave it out when the export had no PDF: `history show` then says "no PDF
in the export" rather than hiding the gap.

## What the archive is not

**It is not money owed.** An archived bill marked unpaid is not summed into
`bk billing overview` and nothing chases it — that question belongs to the
books, not to this app. Totals are per currency and never merged, here as
everywhere else in this app.

**It never carries a payment part.** Whatever its currency, an archived bill was
paid, or not, through the system that issued it.
