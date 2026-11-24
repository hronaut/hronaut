import { describe, expect, it, vi } from 'vitest'
import { canvasAtPointIsTainted } from '../src/main/browser/canvas-copy.js'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'

describe('the canvas check before Copy Image', () => {
  it('asks the page in its own isolated world about the canvas at the click', async () => {
    const executeJavaScriptInIsolatedWorld = vi.fn(async () => 'tainted')
    await expect(canvasAtPointIsTainted({ executeJavaScriptInIsolatedWorld }, 375, 105)).resolves.toBe(true)
    expect(executeJavaScriptInIsolatedWorld).toHaveBeenCalledExactlyOnceWith(ISOLATED_WORLDS.canvasCopy, [{ code: expect.stringContaining('375, 105') as string }])
  })

  it.each([['readable'], ['none'], [undefined]])('lets the copy go ahead when the page reports %s', async (answer) => {
    await expect(canvasAtPointIsTainted({ executeJavaScriptInIsolatedWorld: vi.fn(async () => answer) }, 1, 2)).resolves.toBe(false)
  })

  it('lets the copy go ahead when the page cannot be asked', async () => {
    await expect(canvasAtPointIsTainted({ executeJavaScriptInIsolatedWorld: vi.fn(async () => { throw new Error('gone') }) }, 1, 2)).resolves.toBe(false)
  })
})
