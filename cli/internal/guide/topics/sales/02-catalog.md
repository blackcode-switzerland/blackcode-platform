# The catalog: products, templates, documents, and triangulation

Three shared lists and one verdict. The lists are what you sell, how you say it,
and the files you send; the verdict is which of them fits a given prospect.

Related commands: `bk sales product list`, `bk sales product create`, `bk sales
template list`, `bk sales template render`, `bk sales doc list`, `bk sales doc
add`, `bk sales doc link`, `bk sales match list`, `bk sales match set`.

## Products

```bash
bk sales product list
bk sales product create --category <category> --name "Custom module" \
  --price "from CHF 12,000" --pitch "Automate around your tool, not through it."
```

**The price has two forms and both are stored.** `--price` is the price *as
written*, because half a catalogue is not a single number — "on request",
"CHF 4'800 + CHF 190/mo". `--price-from` and `--price-to` are the machine-readable
half where one exists. Neither derives from the other, and the written one is
what a reader sees.

## Templates, and rendering one

```bash
bk sales template list --channel <channel>
bk sales template show 3
bk sales template render 3 --var first_name=Julien --var company="Roches SA"
```

Placeholders are written `{{like_this}}` in the body and are **parsed out for
you** — there is no flag to declare them. That is deliberate: a declared list
that could disagree with the body would let `render` check against variables the
template does not contain.

**A missing variable is a failure, not a gap in the output.** A rendered message
still containing a literal `{{first_name}}` is one you would paste into an email,
and the mistake would be visible only to the person receiving it. The error names
each missing variable and the full declared set, so the retry is one command.

Rendering sends nothing and records nothing. It is a read.

## Documents: one library, many links

```bash
bk sales upload contract.pdf                     # → prints a URL
bk sales doc add --title "Phase 2 offer" --kind <kind> --upload <url>
bk sales doc add --title "Demo recording" --kind <kind> --url https://…
bk sales doc add --title "Phase 2 offer" --kind <kind> --upload <url> \
  --prospect 12 --prospect 14                    # create and attach in one call
bk sales doc link 4 --prospect 12                # attach one that already exists
bk sales doc list --prospect 12
```

`--prospect`, `--product` and `--template` on `doc add` are repeatable and write
the same links `doc link` does. If the document is created and a link then fails,
the error says so and names the #number — **do not add it again**; attach the
rest with `doc link`.

A document is **either** a file stored against this app **or** an external link,
never both, and the difference is not cosmetic: only a stored file is covered by
the platform's delete gate, so putting an uploaded file's URL in the external
field would hide it from the index that stops it being deleted while still in use.

`--prospect` on `doc list` **filters the library**. It does not list a separate
per-prospect set — a document attached to three prospects is one row with three
links, and unlinking it from one leaves it on the others.

Note the upload command is `bk sales upload`, with the app name. A file belongs
to exactly one app, and the app segment is what decides which. `bk guide
platform/apps` has the rule.

## Triangulation — the one thing you decide

```bash
bk sales match set 12 --product 3 --fit 85 --template 7 \
  --why "They already run the incumbent tool and will not migrate."
bk sales match list 12
```

**Nothing computes this.** There is no recommendation engine in this app and
there will not be one: which product suits a client and which message to lead
with is judgement, and the app stores judgements rather than making them. That is
the same line that makes `bk sales pipeline` computed — summing deal values is
arithmetic, choosing a pitch is not.

`--fit` is a percentage *you* decided. `--why` is your reasoning, and it is the
field worth writing: it is what the next run reads instead of guessing why this
pairing was chosen.

Setting a match for a pair that already has one **replaces** it. The record holds
one verdict per prospect-and-product, so it cannot accumulate three scores that
contradict each other.
