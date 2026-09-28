'use client'

// The "PDF · Drive" link for an imported bill's `drive_path` (ticket #94).
//
// The url shaping is `describeFile` from `@blackcode/platform-file-providers` —
// the platform's one shaper, so a Drive link here and a Drive link in b/sales
// resolve and are labelled the same way.
//
// WHAT IT DOES NOT DECIDE, and why this file still exists: whether the stored
// value is openable at all. `drive_path` is "a path or id on Google Drive, or
// null" (lib/db/queries/history.ts), and the imported rows hold all three
// shapes — a link, a bare id, and a human folder path like
// "Factures archivées/Invoicely/2019/INV-0184.pdf" that names where a file
// sits without resolving to anything. `describeFile` answers for a URL; asked
// about a folder path it still returns a descriptor, and rendering that as an
// <a> would be a dead link dressed as a working one. So the shape is decided
// here, once, and only the openable shapes reach the shaper.

import { ExternalLink } from 'lucide-react'
import { describeFile } from '@blackcode/platform-file-providers'
import { cn } from '@/lib/utils'

/** A Drive id: the opaque handle Drive uses in every one of its url shapes. */
const DRIVE_ID = /^[\w-]{10,}$/

/**
 * `drive_path` is stored as either a path/id on Drive or a full Drive link
 * (`lib/db/queries/history.ts`'s validator: "must be a path or id on Google
 * Drive, or null"). Some imported rows carry neither — the seeded fixtures
 * (`fixtures/mockup.json`) hold human folder paths like
 * `"Factures archivées/Invoicely/2019/INV-0184.pdf"`, a description of where
 * the file sits, not an id or link that resolves to anything on its own. Only
 * the two shapes below are actually openable; anything else is honest text,
 * not a dead link dressed up as a working one.
 */
export function driveOpenUrl(drivePath: string): { url: string; label: string } | null {
  const trimmed = drivePath.trim()
  const raw = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : DRIVE_ID.test(trimmed)
      ? `https://drive.google.com/file/d/${trimmed}/view`
      : null
  if (!raw) return null
  const file = describeFile(raw)
  return { url: file.open_url, label: file.label }
}

export interface HistoryDriveLinkProps {
  drivePath: string | null
  className?: string
}

/**
 * "PDF · Drive" when `drive_path` is an id or link that can be opened; the raw
 * path as muted text when it is present but not openable; "no PDF in export"
 * when it is null.
 */
export function HistoryDriveLink({ drivePath, className }: HistoryDriveLinkProps) {
  if (!drivePath) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)} data-testid="history-drive-link">
        no PDF in export
      </span>
    )
  }

  const open = driveOpenUrl(drivePath)
  if (!open) {
    return (
      <span className={cn('truncate text-xs text-muted-foreground', className)} data-testid="history-drive-link" title={drivePath}>
        {drivePath}
      </span>
    )
  }

  return (
    <a
      href={open.url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="history-drive-link"
      onClick={(e) => e.stopPropagation()}
      className={cn('inline-flex items-center gap-1 text-xs text-primary hover:underline', className)}
    >
      <ExternalLink size={12} />
      PDF · {open.label}
    </a>
  )
}
