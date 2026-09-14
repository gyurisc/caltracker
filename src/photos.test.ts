import { describe, expect, it } from 'vitest'
import { photoId, readPhoto } from './photos.ts'

describe('photo ids', () => {
  it('carries the date, so a photo is findable from the id alone', () => {
    const id = photoId('2026-09-14', Buffer.from('abc'))
    expect(id.startsWith('2026-09-14-')).toBe(true)
  })

  it('is the same for the same bytes, so a resend does not duplicate', () => {
    expect(photoId('2026-09-14', Buffer.from('abc')))
      .toBe(photoId('2026-09-14', Buffer.from('abc')))
    expect(photoId('2026-09-14', Buffer.from('abc')))
      .not.toBe(photoId('2026-09-14', Buffer.from('abd')))
  })
})

describe('reading by id', () => {
  // The id arrives off a URL, so it is untrusted input pointed at a filesystem.
  it('refuses anything that is not the exact id shape', () => {
    for (const bad of [
      '../../etc/passwd',
      '2026-09-14-../../../etc/passwd',
      '2026-09-14-deadbeef/../../x',
      '2026-09-14-DEADBEEFDEADBEEF',
      '2026-09-14-deadbeef',
      '',
    ]) {
      expect(readPhoto(bad)).toBeNull()
    }
  })

  it('returns null for a well-formed id with no file', () => {
    expect(readPhoto('2026-09-14-deadbeefdeadbeef')).toBeNull()
  })
})
