import { it, expect, vi } from 'vitest'
import { RegionReceipts } from '../src/main/regionReceipts'
it('scopes pixel hashes, suppresses pending/accepted/uncertain repeats and allows deliberate or known-failed retries', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100)
  try {
    const receipts = new RegionReceipts(),
      image = { jpeg: 'cGl4ZWxz', thumbnail: 'thumb' }
    const claim = receipts.claim(image)
    expect(receipts.claim({ ...image, thumbnail: 'smaller' }).skip).toMatchObject({
      notice: expect.stringMatching(/queued/),
    })
    expect(receipts.claim({ ...image, jpeg: 'bmV3' }).skip).toBeUndefined()
    receipts.finish(claim.key, { ok: false, reason: 'declined' })
    expect(receipts.claim(image).skip).toBeUndefined()
    receipts.finish(claim.key, { ok: false, uncertain: true, reason: 'lost acknowledgement' })
    expect(receipts.claim(image).skip).toMatchObject({ ok: false, uncertain: true })
    clock.mockReturnValue(5200)
    expect(receipts.claim(image).skip).toBeUndefined()
    receipts.finish(claim.key, { ok: true })
    expect(receipts.claim(image).skip).toMatchObject({
      notice: expect.stringMatching(/already sent/),
    })
    expect(new RegionReceipts().claim(image).skip).toBeUndefined()
    clock.mockReturnValue(10300)
    expect(receipts.claim(image).skip).toBeUndefined()
  } finally {
    clock.mockRestore()
  }
})
