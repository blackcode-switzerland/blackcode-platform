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

## What to quote, and whose page it is

```bash
bk sales product edit 3 --internal-price-min 8000 --internal-price-max 12000 \
  --internal-price-note "Hold at 12k unless they commit to the maintenance retainer."
```

`--price` is what the CATALOGUE says. `--internal-price-*` is what you may
quote, and it is not customer-facing: it prints under an `INTERNAL` heading in
`bk sales product show` and is shown only inside the workspace. A range rather
than a number, because that is what a rep actually holds — a floor with no
ceiling ("never below 8k") is a legitimate answer, and so is a note instead of
either.

The floor must not be above the ceiling; the route refuses that outright. It is
the one mistake this pair can carry that nothing downstream would notice — a rep
reading an inverted range does not see a broken range, they see a number.

```bash
bk sales product edit 1 --reach external --external-url https://aioscompanion.com
```

`--reach` says how far our own site carries a product. `internal` (the default)
means the full story is ours to tell. `external` means the product has its own
brand and site — our page is a teaser plus a link, because duplicating somebody
else's marketing copy goes stale the moment they update it. Run `bk meta` for
the current values.

`--external-url` is its own field and NOT a `--ref`: `--ref` is reference
CUSTOMERS, by name, and putting a URL there quietly changes what that list means
for everyone reading it.

## Strategies: why a segment was chosen

```bash
bk sales strategy add --name "Lausanne watch & jewellery" \
  --vertical "watch & jewellery boutiques" --area Lausanne \
  --why "Small independents, no online presence, high-value inventory." \
  --case-studies "consciencegems.ch — e-commerce build" \
  --product 3 --product 8
bk sales strategy list
bk sales strategy show 1
```

A strategy is the REUSABLE half of "which product suits whom": the reasoning
behind going after a whole vertical or area, and what we lead with. It applies
to ten prospects at once, which is why it is a record with its own #number
rather than a field — copied onto each prospect it would go stale nine times.

`--why` is the part worth writing. It is what the next person (or the next run)
reads instead of reconstructing the reasoning from a list of prospects, and it
is the whole reason this record exists rather than a tag.

**`--product` REPLACES the set, it does not add to it.** Pass every product the
strategy leads with. `--no-products` on `edit` clears it. There are no
add/remove verbs deliberately: expressing "these two" through them takes three
calls and requires first finding out what is there now.

Link a prospect to one, and give that prospect its own angle on top:

```bash
bk sales prospect edit 12 --strategy 1 \
  --game-plan "Angle: they already photograph every piece. Open with one collection, not the catalogue. Expect a price objection — answer with the consciencegems build."
```

**The two are different on purpose.** The strategy is why the SEGMENT was
chosen; `--game-plan` is what to say to THIS company on the way into THIS
meeting — the upsell angle, the talking points, the objections to expect.
`bk sales prospect show` prints the game plan above the ledgers, because it is
what you read before a meeting rather than after one.

`--strategy ""` unlinks. Binning a strategy is a SOFT delete — it goes to
`bk sales trash` and restores — and the prospects pointing at it are
deliberately NOT unlinked, because a soft delete that detached them could not be
undone. The command tells you how many deals are affected.

Going the other way — every prospect one strategy is running against —
`bk sales strategy show <n>` lists them, and `bk sales prospect list --strategy
<n>` is the filtered listing (`bk guide sales/pipeline`).
