'use client'

// Bare building blocks for the minimal test UI (see lib/web.ts's header).
// Deliberately unstyled beyond legibility: the real design is the frontend
// tickets' job, and anything added here is something they would have to undo.

import { useCallback, useEffect, useState } from 'react'
import { describeError } from '@/lib/web'

export const box: React.CSSProperties = { fontFamily: 'system-ui', padding: 24, maxWidth: 1100 }
export const table: React.CSSProperties = { borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }
export const cell: React.CSSProperties = { border: '1px solid #ccc', padding: '4px 8px', textAlign: 'left', verticalAlign: 'top' }
export const field: React.CSSProperties = { display: 'block', margin: '4px 0' }

/**
 * Load a route on mount and on `reload()`. `reload()` returns a promise that
 * settles when the new data is IN STATE — a write awaits it before announcing
 * success, so the success line never sits beside the old values (a test that
 * reads the page right after "done" appears would otherwise race the refresh,
 * and so would a person).
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps)
  const reload = useCallback(() => {
    setError(null)
    return run()
      .then(setData)
      .catch((e) => setError(describeError(e)))
  }, [run])
  useEffect(() => {
    void reload()
  }, [reload])
  return { data, error, reload }
}

/** Run a write, report its error or its success line. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const msg = await fn()
      if (msg) setDone(msg)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, done, run }
}

export function ErrorLine({ error, testId = 'error' }: { error: string | null; testId?: string }) {
  if (!error) return null
  return (
    <p role="alert" data-testid={testId} style={{ color: '#a00', whiteSpace: 'pre-wrap' }}>
      {error}
    </p>
  )
}

export function DoneLine({ done, testId = 'done' }: { done: string | null; testId?: string }) {
  if (!done) return null
  return (
    <p role="status" data-testid={testId} style={{ color: '#060' }}>
      {done}
    </p>
  )
}

/** A labelled text input bound to one key of a form object. */
export function Input({
  label,
  name,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  name: string
  value: string
  onChange: (name: string, v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <label style={field}>
      <span style={{ display: 'inline-block', minWidth: 140, fontSize: 13 }}>{label}</span>
      <input
        name={name}
        data-testid={`input-${name}`}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(name, e.target.value)}
        style={{ padding: '3px 6px', minWidth: 260 }}
      />
    </label>
  )
}

/** Form state as a flat record of strings, with a setter `Input` can call. */
export function useForm<K extends string>(initial: Record<K, string>) {
  const [form, setForm] = useState(initial)
  const set = (name: string, v: string) => setForm((f) => ({ ...f, [name]: v }))
  return { form, set, reset: () => setForm(initial) }
}

/** Empty string → null; otherwise trimmed. */
export const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())
