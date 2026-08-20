// The robot door's id-versus-link check, pinned on the delivery that prompted it.
import { describe, it, expect } from 'vitest'
import { driveSourceRefusal, checksumRefusal } from './drive'

const ID = '1TbLMz3WTc65dkq100ly106Xz1rviK3Rr'
const LINK = `https://drive.google.com/file/d/${ID}/view?usp=drivesdk`

describe('driveSourceRefusal', () => {
  it('accepts the pair delivered the right way round', () => {
    expect(driveSourceRefusal({ file_id: ID, web_view_link: LINK })).toBeNull()
  })

  // This REPLACED "accepts no link at all". The second report (2026-08-20) was
  // a delivery with no link: accepted, and the screen had nothing to render but
  // the bare id. A pièce nobody can open is not evidence.
  it('refuses a delivery with no link, and says the worker already has one', () => {
    for (const link of [undefined, null, '']) {
      const r = driveSourceRefusal({ file_id: ID, web_view_link: link })
      expect(r?.code, `web_view_link: ${String(link)}`).toBe('missing_web_view_link')
    }
    expect(driveSourceRefusal({ file_id: ID })?.suggestion).toContain('webViewLink')
  })

  // 2026-08-20: exactly this landed, and the reference filed against the entry
  // was a string that opens nothing.
  it('refuses a file id in the link field, and says which field holds it', () => {
    const r = driveSourceRefusal({ file_id: ID, web_view_link: ID })
    expect(r?.code).toBe('web_view_link_is_a_file_id')
    expect(r?.message).toContain(ID)
    expect(r?.suggestion, 'the caller has the right value under another key').toContain('webViewLink')
    expect(r?.suggestion, 'the shape is shown so an agent knows what to fetch').toContain(
      `https://drive.google.com/file/d/${ID}/view`
    )
  })

  it('refuses the mirror mistake — a link where the id belongs', () => {
    const r = driveSourceRefusal({ file_id: LINK, web_view_link: LINK })
    expect(r?.code).toBe('file_id_is_a_url')
    // The id is the dedupe key, so this one does not merely look wrong.
    expect(r?.suggestion).toContain('idempotency')
  })

  it('the mirror check does not depend on a scheme — a path is enough', () => {
    expect(driveSourceRefusal({ file_id: `file/d/${ID}/view` })?.code).toBe('file_id_is_a_url')
  })

  it('refuses a link that is neither a URL nor a file id', () => {
    const r = driveSourceRefusal({ file_id: ID, web_view_link: 'see the shared folder' })
    expect(r?.code).toBe('bad_web_view_link')
  })

  it('refuses a non-string link rather than coercing it', () => {
    expect(driveSourceRefusal({ file_id: ID, web_view_link: 42 })?.code).toBe('bad_web_view_link')
  })

  it('a Drive id is accepted in the id field whatever it looks like', () => {
    // Ids are opaque and their alphabet is Drive's business, not ours: the only
    // thing refused there is something that is plainly a URL. Checked with a
    // link present, since the link is required in its own right.
    expect(
      driveSourceRefusal({ file_id: 'test-tampered', web_view_link: LINK }),
      'the suite ingests short fake ids'
    ).toBeNull()
  })
})

describe('checksumRefusal', () => {
  it('either checksum satisfies it', () => {
    expect(checksumRefusal({ sha256: 'a'.repeat(64) })).toBeNull()
    expect(checksumRefusal({ md5_checksum: 'd41d8cd98f00b204e9800998ecf8427e' })).toBeNull()
  })

  // The red line in both reports. The consequence is sharper than the phrase:
  // with no checksum the dedupe key is '', so the NEXT capture of the same file
  // id is mistaken for a retry and dropped.
  it('refuses a delivery with neither, and names what would be lost', () => {
    const r = checksumRefusal({ file_id: ID })
    expect(r?.code).toBe('missing_checksum')
    expect(r?.suggestion).toContain('reissued invoice')
  })

  it('an empty or blank checksum is not a checksum', () => {
    expect(checksumRefusal({ sha256: '', md5_checksum: '   ' })?.code).toBe('missing_checksum')
  })
})
