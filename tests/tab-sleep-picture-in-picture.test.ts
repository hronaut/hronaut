import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { showsPictureInPicture } from '../src/main/browser/tab-sleep/tab-sleep.js'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'

/** A frame inside the page, answering whether a video of its own shows in Picture in picture. */
function frame(answer: () => Promise<unknown>, state: { detached?: boolean; destroyed?: boolean } = {}) {
  return { detached: state.detached ?? false, isDestroyed: () => state.destroyed ?? false, executeJavaScript: vi.fn(answer) }
}

/** A tab whose page answers in its own world, with the frames inside it. */
function tab(page: () => Promise<unknown>, frames: Array<ReturnType<typeof frame>> = []) {
  const mainFrame = { framesInSubtree: [] as unknown[] }
  mainFrame.framesInSubtree = [mainFrame, ...frames]
  const webContents = { isDestroyed: () => false, mainFrame, executeJavaScriptInIsolatedWorld: vi.fn(page) }
  return { webContents } as never as Parameters<typeof showsPictureInPicture>[0] & { webContents: typeof webContents }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a tab showing a video in Picture in picture', () => {
  it('says so from the page’s own frame, which answers in a world of its own', async () => {
    // Sleeping replaced the page, which closed the video's Picture in picture window, where Chrome never discards it.
    const shown = tab(async () => true)
    expect(await showsPictureInPicture(shown)).toBe(true)
    expect(shown.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledExactlyOnceWith(ISOLATED_WORLDS.tabSleep, [{ code: 'document.pictureInPictureElement !== null' }])
  })

  it('says so from a frame inside the page, such as an embedded player', async () => {
    const quiet = frame(async () => false)
    const player = frame(async () => true)
    expect(await showsPictureInPicture(tab(async () => false, [quiet, player]))).toBe(true)
    expect(quiet.executeJavaScript).toHaveBeenCalledOnce()
  })

  it('shows none when no frame says so, a frame is gone, or the page cannot answer', async () => {
    const gone = frame(async () => true, { detached: true })
    expect(await showsPictureInPicture(tab(async () => false, [frame(async () => false), gone]))).toBe(false)
    expect(gone.executeJavaScript).not.toHaveBeenCalled()
    expect(await showsPictureInPicture(tab(async () => { throw new Error('Render frame was disposed') }, [frame(async () => true)]))).toBe(false)
    expect(await showsPictureInPicture(tab(async () => 'yes'))).toBe(false)
  })

  it('does not wait for a frame that never answers', async () => {
    const answer = showsPictureInPicture(tab(async () => false, [frame(() => new Promise(() => {})), frame(async () => true)]))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await answer).toBe(true)
  })
})
