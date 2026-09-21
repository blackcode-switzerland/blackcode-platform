'use client'

// "Import…" — paste an array of rows (as `bk billing history import --help`
// describes) and POST them, all or nothing. Server errors shown in full: an
// import is a one-off an agent or a human runs once for the whole archive, and
// a refused row should be visible enough to fix without guessing.

import { useState } from 'react'
import { Modal } from '@blackcode/platform-ui/ui/modal'
import { ErrorState, Hint, Textarea } from '@/components/ui-kit'

export function ImportHistoryModal({
  open,
  onClose,
  onSubmit,
  busy,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (rows: unknown) => Promise<void>
  busy: boolean
}) {
  const [json, setJson] = useState('[]')
  const [parseError, setParseError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<unknown>(null)

  const run = async () => {
    setParseError(null)
    setSubmitError(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      setParseError('That is not JSON — paste an array of rows.')
      return
    }
    try {
      await onSubmit(parsed)
      setJson('[]')
    } catch (e) {
      setSubmitError(e)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Import history"
      description="An array of rows, as `bk billing history import --help` describes. All rows are written, or none."
      widthClass="max-w-lg"
    >
      <div className="space-y-3">
        <div>
          <Textarea
            data-testid="input-rows"
            rows={10}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            className="font-mono text-xs"
            placeholder='[{"source": "zoho", "source_ref": "ZB-000281", …}]'
          />
          <Hint className="mt-1">Unknown keys are refused, not ignored — a typo in a field name fails the whole import rather than dropping data.</Hint>
        </div>
        {parseError && <p className="text-xs text-destructive" role="alert" data-testid="error">{parseError}</p>}
        {submitError ? <ErrorState error={submitError} testId="error" compact /> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="history-import"
            onClick={() => void run()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
