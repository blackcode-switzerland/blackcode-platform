'use client'

// The catalog: Products, Templates, Documents.
//
// Two of the three corners of triangulation live here — **what we sell** and
// **how we say it**. The third is the prospect, and the *result* of putting them
// together is the stored match on the prospect page. Nothing on these pages
// computes a fit; they are the inventory the agent draws from.
//
// ── DOCUMENTS IS ONE LIBRARY (D-8) ──────────────────────────────────────────
// This page and the prospect's Documents tab call the SAME route; the tab adds
// `?prospect=`. There is no per-prospect store and there must not be — that is
// the fix `UPDATE-6.md` was written to make, and the shared `DocumentList`
// component is what stops the two rendering differently.

import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import {
  DocumentKindChip,
  ProductCategoryChip,
  RecordNumber,
  TemplateCategoryChip,
} from '@/components/chips'
import { BlockSkeleton, EmptyState, ErrorState } from '@/components/states'
import {
  ClearFilters,
  FilterBar,
  FilterSelect,
  FilteredEmpty,
  TagFilterChip,
  useFilterList,
  useFilterParam,
} from '@/components/filters'
import { AgentOnly } from '@/components/forms'
import { DocumentList } from '@/components/prospects/prospect-detail'
import { useDocuments, useProducts, useProspects, useTemplates, type Product } from '@/lib/hooks'
import { money } from '@/lib/format'
import {
  DOCUMENT_KINDS,
  TEMPLATE_CATEGORIES,
  TEMPLATE_CHANNELS,
  productReachColor,
  productReachLabel,
  stageLabel,
  templateChannelLabel,
} from '@/lib/pipeline'

// Generic in the element: products and templates focus an <article>, documents
// focus the <a> that IS the row. `scrollIntoView` is on Element, so nothing here
// needs to know which.
function useFocusRef<E extends HTMLElement>(focus: number | null) {
  const ref = useRef<E>(null)
  useEffect(() => {
    if (focus != null) ref.current?.scrollIntoView({ block: 'center' })
  }, [focus])
  return ref
}

function useFocus() {
  const params = useSearchParams()
  const raw = params?.get('focus')
  return raw ? Number(raw) : null
}

/**
 * A one- or two-ended internal price range.
 *
 * A floor with no ceiling ("never below 8k") is a legitimate answer, so this
 * must not render as "CHF 8'000 – " with nothing after the dash. Mirrors
 * `internalRange` in `cli/internal/commands/sales/catalog.go`.
 */
function internalRange(p: Product): string {
  const from = p.internal_price_min ? money(p.internal_price_min, p.currency) : null
  const to = p.internal_price_max ? money(p.internal_price_max, p.currency) : null
  if (from && to) return `${from} – ${to}`
  if (from) return `from ${from}`
  return `up to ${to}`
}

export function ProductsPage({ ws }: { ws: string }) {
  const products = useProducts(ws)
  const focus = useFocus()
  const focusRef = useFocusRef<HTMLDivElement>(focus)

  if (products.isPending) return <BlockSkeleton rows={4} />
  if (products.error) return <ErrorState error={products.error} />
  if (products.data.length === 0) {
    return (
      <EmptyState
        title="Nothing in the catalog"
        hint="Products are maintained by the agent."
      />
    )
  }

  return (
    <div className="space-y-2">
      <AgentOnly what="Products" />
      {products.data.map((p) => (
        <article
          key={p.number}
          ref={p.number === focus ? focusRef : undefined}
          className={
            'rounded-xl border bg-card px-4 py-4 ' +
            (p.number === focus ? 'border-primary' : 'border-border')
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <RecordNumber n={p.number} />
            <ProductCategoryChip value={p.category} />
            <h3 className="text-sm font-medium text-foreground">{p.name}</h3>
            <span className="ml-auto text-sm tabular-nums text-foreground">
              {/*
                The price AS WRITTEN wins. Half the catalogue is not a single
                number ("from CHF 8'000", "on request"), and `lib/views.ts`
                serves both halves rather than deriving one from the other — so
                the label is what a human wrote and the numeric range is what a
                machine can compare. Rendering the label when there is one keeps
                the page saying what the business says.
              */}
              {p.price_label ??
                (p.price_from ? `from ${money(p.price_from, p.currency)}` : '—')}
            </span>
          </div>
          {p.description && (
            <p className="mt-1.5 text-sm text-muted-foreground">{p.description}</p>
          )}
          {/*
            An external product's own site (#29). The chip says which kind it is
            because that changes what our page is FOR — a teaser that routes
            onward, not a full description we would then have to keep in step
            with somebody else's marketing.
          */}
          {p.reach === 'external' && (
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              <span
                className="rounded px-1.5 py-0.5 font-medium"
                style={{
                  backgroundColor: `${productReachColor(p.reach)}22`,
                  color: productReachColor(p.reach),
                }}
              >
                {productReachLabel(p.reach)}
              </span>
              {p.external_url && (
                <a
                  href={p.external_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {p.external_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              )}
            </p>
          )}
          {/*
            ── INTERNAL PRICE GUIDANCE (#27) ──────────────────────────────
            Labelled on screen every time, not merely stored under an
            internal-sounding key. The one context where this number must not
            be read out is the one where somebody forgot which field it came
            from — so the field says so itself.

            This page is behind workspace auth. If #26's public product pages
            are built, they need their OWN component and their own projection:
            reusing this one is exactly how the number ships to a customer.
          */}
          {(p.internal_price_min || p.internal_price_max || p.internal_price_note) && (
            <div className="mt-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Internal — not our published price
              </p>
              {(p.internal_price_min || p.internal_price_max) && (
                <p className="mt-0.5 text-sm tabular-nums text-foreground">
                  {internalRange(p)}
                </p>
              )}
              {p.internal_price_note && (
                <p className="mt-0.5 text-xs text-muted-foreground">{p.internal_price_note}</p>
              )}
            </div>
          )}
          {p.pitch && (
            <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
              {p.pitch}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {p.fit.length > 0 && <span>Fits: {p.fit.join(', ')}</span>}
            {p.refs.length > 0 && <span>Refs: {p.refs.join(', ')}</span>}
            {p.status_label && <span>{p.status_label}</span>}
          </div>
        </article>
      ))}
    </div>
  )
}

/**
 * Copy one field to the clipboard.
 *
 * ── BOTH OUTCOMES GET A TOAST ───────────────────────────────────────────────
 * `navigator.clipboard.writeText` is permission-gated, unavailable on an
 * insecure origin, and rejects when the document is not focused. It FAILS, and a
 * copy button that fails silently is worse than none: the reader pastes whatever
 * was on the clipboard before — the previous template, very often — into an
 * email to a customer. So the rejection is caught and said out loud, which is
 * the same rule every mutation in this app follows.
 *
 * The checkmark is a two-second acknowledgement on top of the toast, because the
 * button is the thing the eye is on when it is clicked.
 */
function CopyButton({ label, text, what }: { label: string; text: string; what: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
          toast.success(`${what} copied`)
        } catch {
          // No `err.message` in the toast: the browser's own wording here is
          // "Document is not focused", which tells a person nothing they can
          // act on. Say what to do instead.
          toast.error(`Could not copy the ${what.toLowerCase()} — select it and press ⌘C`)
        }
      }}
      className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
      {label}
    </button>
  )
}

export function TemplatesPage({ ws }: { ws: string }) {
  const [channel, setChannel] = useFilterParam('channel')
  const [category, setCategory] = useFilterParam('category')
  const templates = useTemplates(ws, {
    channel: channel || undefined,
    category: category || undefined,
  })
  const focus = useFocus()
  const focusRef = useFocusRef<HTMLDivElement>(focus)
  const filtered = Boolean(channel || category)

  const bar = (
    <FilterBar>
      <FilterSelect
        label="Channel"
        value={channel}
        onChange={setChannel}
        options={TEMPLATE_CHANNELS}
        allLabel="All channels"
      />
      <FilterSelect
        label="Category"
        value={category}
        onChange={setCategory}
        options={TEMPLATE_CATEGORIES}
        allLabel="All categories"
      />
      <ClearFilters active={filtered} keep={['focus']} />
    </FilterBar>
  )

  if (templates.isPending) return <BlockSkeleton rows={4} />
  if (templates.error) return <ErrorState error={templates.error} />
  if (templates.data.length === 0) {
    return (
      <div className="space-y-3">
        {/* The bar stays on screen when the result is empty. Without it a
            filtered-to-nothing page offers no way back — the control that
            caused the emptiness is the one thing that must not disappear
            with the rows. */}
        {bar}
        <FilteredEmpty
          filtered={filtered}
          noun="templates"
          emptyTitle="No templates"
          emptyHint="Templates are maintained by the agent."
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {bar}
      <AgentOnly what="Templates" />
      {templates.data.map((t) => (
        <article
          key={t.number}
          ref={t.number === focus ? focusRef : undefined}
          className={
            'rounded-xl border bg-card px-4 py-4 ' +
            (t.number === focus ? 'border-primary' : 'border-border')
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <RecordNumber n={t.number} />
            <TemplateCategoryChip value={t.category} />
            <h3 className="text-sm font-medium text-foreground">{t.name}</h3>
            <span className="text-xs text-muted-foreground">
              {templateChannelLabel(t.channel)}
              {t.stage && ` · ${stageLabel(t.stage)}`}
            </span>
            {/*
              THE SUBJECT AND THE BODY COPY SEPARATELY, and they are not
              concatenated into one button. A subject line and a message body go
              into two different fields of a mail client; a single "Copy" that
              produced "Re: your quote\n\nHi {{first_name}}…" gives a person
              something they have to edit before it is usable anywhere, which is
              most of the work the button was meant to save.

              `{{placeholders}}` are copied VERBATIM. They are the point — the
              template declares what it needs and `bk sales template render`
              fills them; a browser silently blanking them would hand somebody a
              letter addressed to nobody.
            */}
            <span className="ml-auto flex items-center gap-1.5">
              {t.subject && <CopyButton label="Subject" what="Subject" text={t.subject} />}
              {t.body && <CopyButton label="Copy" what="Message" text={t.body} />}
            </span>
          </div>
          {t.subject && (
            <p className="mt-1.5 text-sm text-foreground">
              <span className="text-muted-foreground">Subject: </span>
              {t.subject}
            </p>
          )}
          {t.body && (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 font-sans text-sm leading-relaxed text-foreground">
              {t.body}
            </pre>
          )}
          {/*
            The variables the body declares, parsed on write and served so a
            caller knows what `template render` will demand BEFORE it fails. A
            human reading this page wants the same warning.
          */}
          {t.variables.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Needs:
              {t.variables.map((v) => (
                <code key={v} className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {'{{'}
                  {v}
                  {'}}'}
                </code>
              ))}
            </p>
          )}
        </article>
      ))}
    </div>
  )
}

export function DocumentsPage({ ws }: { ws: string }) {
  const [kind, setKind] = useFilterParam('kind')
  const [prospect, setProspect] = useFilterParam('prospect')
  const [product, setProduct] = useFilterParam('product')
  const [tags, toggleTag] = useFilterList('tag')

  const docs = useDocuments(ws, {
    kind: kind || undefined,
    prospect: prospect ? Number(prospect) : undefined,
    product: product ? Number(product) : undefined,
    tag: tags.length ? tags.join(',') : undefined,
  })
  // A document is addressable — `bc:sales:{ws}/document/{n}` — and this listing
  // is where that URN resolves, so it has to honour ?focus= like every other
  // listing. It did not until 2026-08-07; see lib/dashboard-paths.test.ts.
  const focus = useFocus()
  const filtered = Boolean(kind || prospect || product || tags.length)

  const prospects = useProspects(ws)
  const products = useProducts(ws)
  const prospectOptions = useMemo(
    () => (prospects.data?.data ?? []).map((p) => ({ value: String(p.number), label: p.name })),
    [prospects.data]
  )
  const productOptions = useMemo(
    () => (products.data ?? []).map((p) => ({ value: String(p.number), label: p.name })),
    [products.data]
  )

  // ── THE TAG VOCABULARY COMES FROM AN UNFILTERED READ, DELIBERATELY ────────
  // Building the chip row out of `docs.data` — the FILTERED result — is the
  // obvious thing and it is a trap: selecting `pricing` narrows the list to the
  // documents tagged `pricing`, whose tags are then the only chips left, so
  // every other tag vanishes the moment you use one and there is no way back
  // except Clear. The row of available filters must not be a function of the
  // filter. This is a second read of the same route with no parameters, which
  // TanStack caches under its own key and shares with the prospect Documents
  // tab.
  const allDocs = useDocuments(ws)
  const allTags = useMemo(() => {
    const seen = new Map<string, string>()
    for (const d of allDocs.data ?? []) {
      // Case-insensitive, matching the route: `Deck` and `deck` are one tag to
      // everybody except a database. The first spelling seen is the one shown.
      for (const t of d.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [allDocs.data])

  const bar = (
    <div className="space-y-2">
      <FilterBar>
        <FilterSelect
          label="Kind"
          value={kind}
          onChange={setKind}
          options={DOCUMENT_KINDS}
          allLabel="All kinds"
        />
        <FilterSelect
          label="Prospect"
          value={prospect}
          onChange={setProspect}
          options={prospectOptions}
          allLabel="All prospects"
        />
        <FilterSelect
          label="Product"
          value={product}
          onChange={setProduct}
          options={productOptions}
          allLabel="All products"
        />
        <ClearFilters active={filtered} keep={['focus']} />
      </FilterBar>
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Tags match with OR — clicking a second one WIDENS the result. That
              is what a row of chips means everywhere a person has met one, and
              it is what the route does; see `listDocuments`. */}
          {allTags.map(([lower, shown]) => (
            <TagFilterChip
              key={lower}
              tag={shown}
              active={tags.some((t) => t.toLowerCase() === lower)}
              onToggle={() => toggleTag(shown)}
            />
          ))}
        </div>
      )}
    </div>
  )

  if (docs.isPending) return <BlockSkeleton rows={4} />
  if (docs.error) return <ErrorState error={docs.error} />
  if (docs.data.length === 0) {
    return (
      <div className="space-y-3">
        {bar}
        <FilteredEmpty
          filtered={filtered}
          noun="documents"
          emptyTitle="The library is empty"
          emptyHint="Documents are uploaded and added to the library by the agent."
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="px-1 text-xs text-muted-foreground">
        One library. A prospect&rsquo;s Documents tab and a template&rsquo;s
        attachments are filtered views of these rows, never separate stores.
      </p>
      {bar}
      <AgentOnly what="Documents" />
      <DocumentList docs={docs.data} focus={focus} />
      <div className="flex flex-wrap gap-1.5 px-1">
        {/* The kinds present in the CURRENT result, as a legend. Unlike the tag
            row above this one is meant to describe what you are looking at
            rather than offer a filter — the Kind control does that. */}
        {[...new Set(docs.data.map((d) => d.kind))].map((k) => (
          <DocumentKindChip key={k} value={k} />
        ))}
      </div>
    </div>
  )
}
