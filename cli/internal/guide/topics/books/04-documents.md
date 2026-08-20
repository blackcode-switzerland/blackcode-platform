# Pièces justificatives, and the robot door

A pièce is the proof behind an entry. This app never holds the file: the bytes
live in Drive, and b/books stores the extracted record, the reference and a hash.

Related commands: `bk books piece list`, `bk books piece ingest`, `bk books piece
match`, `bk books manifest`, `bk books source record-pull`.

```bash
bk books piece list --entity acme
bk books piece ingest --file extraction.json
bk books piece ingest --file -            # from stdin
bk books piece match 7 --entry 16
bk books manifest 8                       # every Drive file one source has seen
```

## The ingest door is built for a worker, not a person

`piece ingest` takes an **ExtractionResult JSON**, not a PDF and not an image.
b/books serves no upload route at all. Something outside — a Drive worker, or an
agent harness driving a model — downloads the file, hashes the bytes, archives
the original, reads it, and posts the structured result through this door.

A payload names the document type, the merchant, the transaction total and
currency, its lines (an empty array is allowed), and a confidence:

```json
{"document_type":"invoice",
 "merchant":{"name":"OfficeWorld Lausanne"},
 "transaction":{"total":318.40,"currency":"CHF","date":"2026-04-18"},
 "lines":[{"description":"Papier A4","amount":89.50,"vat_rate":8.1},
          {"description":"Cartouches","amount":228.90,"vat_rate":8.1}],
 "confidence":0.94,
 "entity":"acme",
 "source":{"file_id":"drive-officeworld-2026-04-18","sha256":"3b1f…4d5e"}}
```

Four rules the door enforces, and each matters to whatever is driving it:

**It re-validates and ignores your verdict.** The line amounts must sum to the
total exactly, and every VAT rate must be one the law allows. A confidence of
0.99 changes nothing; the worker's own opinion is stored and never read.

**A bad document lands rather than bouncing.** It arrives staged and FLAGGED for
review, because a wrong total is exactly the document a human must see, and
refusing it at the door would hide it in the worker's retry queue. Only a
structurally broken payload is refused outright.

**It is idempotent** on the file id and checksum, so re-running a harness over
the same folder creates nothing new.

**Duplicates are flagged, never dropped.** A refund looks identical to a
re-scan, and only a person can tell them apart.

**Every delivery needs a LINK and a CHECKSUM.** A pièce nobody can open, or
that cannot be told apart from the next capture of the same file, is a row that
looks like evidence. Both are refused at the door, and both ask only for values
Drive already handed the worker:

    "source": {
      "file_id":       "<Drive id>",
      "web_view_link": "https://drive.google.com/file/d/<id>/view",
      "sha256":        "<64 hex>"
    }

`web_view_link` is what somebody follows to the document years later
(art. 958f). The door will NOT build it out of the id: it cannot check where an
id leads, and a manufactured link that resolves to the wrong thing is worse
than none.

`sha256` (or Drive's `md5Checksum`) is what tells two captures apart. Without
one the dedupe key for that file id is empty, so the NEXT capture is mistaken
for a retry and silently dropped — a reissued invoice would never reach the
inbox. When present, `sha256` must be a real digest: a malformed hash would sit
on an entry as proof that proves nothing.

**`file_id` and `web_view_link` are not interchangeable, and the door checks
both directions.** Drive returns `id` and `webViewLink` side by side, both
opaque strings, and only the second is a URL. Sent the wrong way round, the
pièce used to ingest cleanly and leave the entry pointing at a reference that
opens nothing.

## Matching

`piece match` says which entry the document proves. It writes the entry's pièce
reference and deliberately leaves the evidence tier to you — see the VAT claim
rule in `bk guide books/entries`.

A pièce and an entry must belong to the same book. Two legal entities' records
never mix, and the refusal says so rather than quietly reaching across.

Unmatched pièces sit on the same worklist as unexplained money, with candidate
entries suggested by amount and date.

## The archive is the caller's responsibility

b/books stores the hash, not the file. For the ten-year retention duty the
original has to be kept, immutably, wherever the worker put it — before it
posts. That is the easy step to skip and the one that actually matters, because
a hash proves nothing once the thing it hashed is gone.
