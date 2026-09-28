// `drive_path` is "a path or id on Google Drive, or null" — three shapes in the
// imported rows, and only two of them open. The seeded archive holds the third
// ("Factures archivées/Invoicely/2019/INV-0184.pdf"), so this is not a
// hypothetical: a link built from it would 404 inside Drive while looking
// exactly like a working one.
import { describe, it, expect } from 'vitest'
import { driveOpenUrl } from '@/components/history/drive-link'

describe('driveOpenUrl', () => {
  it('opens a Drive link, labelled by the shared shaper', () => {
    const out = driveOpenUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQ/view')
    expect(out?.url).toContain('drive.google.com')
    expect(out?.label).toBe('Google Drive')
  })

  it('opens a bare Drive id', () => {
    const out = driveOpenUrl('1AbCdEfGhIjKlMnOpQ')
    expect(out?.url).toContain('1AbCdEfGhIjKlMnOpQ')
    expect(out?.label).toBe('Google Drive')
  })

  it('REFUSES a human folder path — the shape the seed actually carries', () => {
    expect(driveOpenUrl('Factures archivées/Invoicely/2019/INV-0184.pdf')).toBeNull()
    expect(driveOpenUrl('Zoho/2021')).toBeNull()
  })
})
