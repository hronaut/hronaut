import { describe, expect, it, vi } from 'vitest'
import { captureStableVideoImage } from '../src/main/browser/video-capture.js'

describe('video compositor capture during navigation', () => {
  it('skips an unsettled document and captures again after it loads', async () => {
    const capture = vi.fn(async () => 'pixels')
    let loading = true
    const sample = () => captureStableVideoImage(capture, () => 2, () => loading)
    await expect(sample()).resolves.toBeNull()
    expect(capture).not.toHaveBeenCalled()
    loading = false
    await expect(sample()).resolves.toBe('pixels')
  })

  it('drops a rejected capture when navigation starts before rejection', async () => {
    let loading = false
    await expect(captureStableVideoImage(async () => {
      loading = true
      throw new Error('UnknownVizError')
    }, () => 2, () => loading)).resolves.toBeNull()
  })

  it('drops a rejected capture from a document that has already been replaced', async () => {
    let generation = 2
    await expect(captureStableVideoImage(async () => {
      generation += 1
      throw new Error('UnknownVizError')
    }, () => generation, () => false)).resolves.toBeNull()
  })

  it('drops successful pixels from a replaced document', async () => {
    let generation = 2
    await expect(captureStableVideoImage(async () => {
      generation += 1
      return 'old pixels'
    }, () => generation, () => false)).resolves.toBeNull()
  })

  it('preserves real capture failures on a settled document', async () => {
    const failure = new Error('UnknownVizError')
    await expect(captureStableVideoImage(async () => { throw failure }, () => 2, () => false))
      .rejects.toBe(failure)
  })
})
