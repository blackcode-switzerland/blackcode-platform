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
import { useEffect, useRef } from 'react'
import {
  DocumentKindChip,
  ProductCategoryChip,
  TemplateCategoryChip,
} from '@/components/chips'
import { BlockSkeleton, EmptyState, ErrorState } from '@/components/states'
import { AgentOnly } from '@/components/forms'
import { DocumentList } from '@/components/prospects/prospect-detail'
import { useDocuments, useProducts, useTemplates } from '@/lib/hooks'
import { money } from '@/lib/format'
import { stageLabel, templateChannelLabel } from '@/lib/pipeline'

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
        hint="Products are maintained by the agent with `bk sales product create`."
      />
    )
  }

  return (
    <div className="space-y-2">
      <AgentOnly what="Products" command="bk sales product create | edit" />
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

export function TemplatesPage({ ws }: { ws: string }) {
  const templates = useTemplates(ws)
  const focus = useFocus()
  const focusRef = useFocusRef<HTMLDivElement>(focus)

  if (templates.isPending) return <BlockSkeleton rows={4} />
  if (templates.error) return <ErrorState error={templates.error} />
  if (templates.data.length === 0) {
    return (
      <EmptyState
        title="No templates"
        hint="Templates are maintained by the agent with `bk sales template create`."
      />
    )
  }

  return (
    <div className="space-y-2">
      <AgentOnly what="Templates" command="bk sales template create | edit" />
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
            <TemplateCategoryChip value={t.category} />
            <h3 className="text-sm font-medium text-foreground">{t.name}</h3>
            <span className="text-xs text-muted-foreground">
              {templateChannelLabel(t.channel)}
              {t.stage && ` · ${stageLabel(t.stage)}`}
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
  const docs = useDocuments(ws)
  // A document is addressable — `bc:sales:{ws}/document/{n}` — and this listing
  // is where that URN resolves, so it has to honour ?focus= like every other
  // listing. It did not until 2026-08-07; see lib/dashboard-paths.test.ts.
  const focus = useFocus()

  if (docs.isPending) return <BlockSkeleton rows={4} />
  if (docs.error) return <ErrorState error={docs.error} />
  if (docs.data.length === 0) {
    return (
      <EmptyState
        title="The library is empty"
        // ── A COMMAND THAT DOES NOT EXIST, ON THE ONLY SCREEN THAT NAMES IT ──
        // This said `bk sales doc create --url` until 2026-08-11. There is no
        // `doc create`: the verb is `add`, and it takes `--title` and `--kind`
        // as well, so somebody following this line got "unknown command" and had
        // no way to tell whether the feature or the sentence was wrong.
        //
        // It is the `bk undo` defect at app scale — prose naming a spelling,
        // covered by nothing. Found by probing every `bk …` string in this app's
        // components against the real binary; it was the only false one of the
        // fifteen. If you add another, run it first.
        hint="Documents are uploaded with `bk sales upload` and added to the library with `bk sales doc add`."
      />
    )
  }

  return (
    <div className="space-y-3">
      <p className="px-1 text-xs text-muted-foreground">
        One library. A prospect&rsquo;s Documents tab and a template&rsquo;s
        attachments are filtered views of these rows, never separate stores.
      </p>
      <AgentOnly what="Documents" command="bk sales upload | doc create" />
      <DocumentList docs={docs.data} focus={focus} />
      <div className="flex flex-wrap gap-1.5 px-1">
        {/* The kinds present, as a legend rather than a filter — the library is
            small and a second control here would out-weigh what it filters. */}
        {[...new Set(docs.data.map((d) => d.kind))].map((k) => (
          <DocumentKindChip key={k} value={k} />
        ))}
      </div>
    </div>
  )
}
