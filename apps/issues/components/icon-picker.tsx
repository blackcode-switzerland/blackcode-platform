'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Search, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { PROJECT_ICON_MAP, ProjectIcon, searchProjectIcons } from './project-icon'

// Mirrors image-upload-field.tsx. Kept in step with it deliberately: both are
// "pick a square image" and a project logo has no reason to accept a type or a
// size a workspace logo would refuse.
const LOGO_ACCEPTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const LOGO_MAX_BYTES = 5 * 1024 * 1024

export const ICON_COLORS = [
  '#6b7280', // gray
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#22c55e', // green
  '#eab308', // amber
  '#f97316', // orange
  '#ec4899', // pink
  '#ef4444', // red
  '#a855f7', // purple
]

interface IconPickerProps {
  icon: string | null
  /** The project's uploaded logo, if it has one. Takes precedence over `icon`. */
  iconUrl?: string | null
  color: string
  name?: string
  /**
   * `iconUrl` is present in the payload ONLY when the logo changed — `undefined`
   * means "leave it alone", `null` means "remove it". Sending the current value
   * back on every icon/colour tweak would be a needless write to a column the
   * blob-reference trigger watches.
   */
  onChange: (next: { icon: string | null; color: string; iconUrl?: string | null }) => void
}

// Linear-style icon + color picker. The chosen color tints the icon. Click the
// tile to open a popover with color swatches, a searchable icon grid, and the
// logo uploader.
//
// A LOGO WINS OVER AN ICON, everywhere (see ProjectIcon). The popover keeps the
// icon grid usable while a logo is set so that removing the logo reveals a
// deliberate choice underneath rather than a blank tile.
export function IconPicker({ icon, iconUrl, color, name, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const ref = useRef<HTMLDivElement>(null)

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!LOGO_ACCEPTED.includes(file.type)) {
      toast.error('Please choose a JPG, PNG, GIF, or WebP image')
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error('Image must be 5MB or smaller')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.url) throw new Error(j.error ?? 'Upload failed')
      onChange({ icon, color, iconUrl: j.url })
      toast.success('Logo updated')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const results = searchProjectIcons(query)

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-border p-1 pr-2 transition-colors hover:bg-secondary"
        title="Choose icon & color"
      >
        <ProjectIcon icon={icon} iconUrl={iconUrl} color={color} name={name} size={32} />
        <ChevronDown size={13} className="text-muted-foreground" />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
          {/* logo — first, because it overrides everything below it */}
          <div className="flex items-center gap-2 border-b border-border p-3">
            <ProjectIcon icon={icon} iconUrl={iconUrl} color={color} name={name} size={36} />
            <input
              ref={fileRef}
              type="file"
              accept={LOGO_ACCEPTED.join(',')}
              onChange={onPickLogo}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
            >
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {iconUrl ? 'Change logo' : 'Upload logo'}
            </button>
            {iconUrl ? (
              <button
                type="button"
                onClick={() => onChange({ icon, color, iconUrl: null })}
                disabled={uploading}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-50"
              >
                <X size={13} />
                Remove
              </button>
            ) : null}
          </div>

          {/* color swatches */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border p-3">
            {ICON_COLORS.map((c) => {
              const selected = c.toLowerCase() === color.toLowerCase()
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange({ icon, color: c })}
                  className="flex size-6 items-center justify-center rounded-full"
                  style={{ backgroundColor: c }}
                  title={c}
                >
                  {selected ? <Check size={13} className="text-white" /> : null}
                </button>
              )
            })}
          </div>

          {/* search */}
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search icons…"
                className="w-full rounded-md border border-border bg-background pl-7 pr-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* grid */}
          <div className="max-h-56 overflow-y-auto p-2">
            {results.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground">No icons match.</p>
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {results.map((key) => {
                  const Icon = PROJECT_ICON_MAP[key]
                  const selected = key === icon
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onChange({ icon: key, color })}
                      title={key}
                      className={`flex aspect-square items-center justify-center rounded-md transition-colors hover:bg-secondary ${
                        selected ? 'ring-1 ring-primary' : ''
                      }`}
                      style={selected ? { color } : undefined}
                    >
                      <Icon size={16} className={selected ? '' : 'text-muted-foreground'} />
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
