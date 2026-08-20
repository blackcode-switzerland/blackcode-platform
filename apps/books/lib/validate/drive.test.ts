// The robot door's id-versus-link check, pinned on the delivery that prompted it.
import { describe, it, expect } from 'vitest'
import { driveSourceRefusal } from './drive'

const ID = '1TbLMz3WTc65dkq100ly106Xz1rviK3Rr'
const LINK = `https://drive.google.com/file/d/${ID}/view?usp=drivesdk`

describe('driveSourceRefusal', () => {
  it('accepts the pair delivered the right way round', () => {
    expect(driveSourceRefusal({ file_id: ID, web_view_link: LINK })).toBeNull()
  })

  it('accepts no link at all — `drive://<id>` is an honest internal reference', () => {
    expect(driveSourceRefusal({ file_id: ID })).toBeNull()
    expect(driveSourceRefusal({ file_id: ID, web_view_link: null })).toBeNull()
    expect(driveSourceRefusal({ file_id: ID, web_view_link: '' })).toBeNull()
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
    // thing refused there is something that is plainly a URL.
    expect(driveSourceRefusal({ file_id: 'test-tampered' }), 'the suite ingests short fake ids').toBeNull()
  })
})
