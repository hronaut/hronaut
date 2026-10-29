import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pageSleepHold, putTabToSleep, setTabSleepingFromContextMenu } from '../src/main/browser/tab-sleep/tab-sleep.js'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'
import { RendererExitedError } from '../src/main/browser/renderer-exit-guard.js'

/** A frame inside the page, answering the form check and whether a video of its own shows in Picture in picture. */
function frame(answer: (code: string) => Promise<unknown>, state: { detached?: boolean; destroyed?: boolean } = {}) {
  return { detached: state.detached ?? false, isDestroyed: () => state.destroyed ?? false, executeJavaScript: vi.fn(answer) }
}

/** Answers only the Picture in picture check, as a page or frame showing a video there does. */
const pictureInPicture = (shown: boolean) => async (code: string) => code.includes('pictureInPictureElement') && shown

/**
 * A tab whose page answers the form check in its own world and Picture in picture in a world of its own, with the
 * frames inside it.
 */
function tab(page: { forms?: () => Promise<unknown>; picture?: () => Promise<unknown> }, frames: Array<ReturnType<typeof frame>> = [], id = 'tab') {
  const mainFrame = { framesInSubtree: [] as unknown[] }
  mainFrame.framesInSubtree = [mainFrame, ...frames]
  const webContents = {
    id: id.length,
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    mainFrame,
    loadURL: vi.fn(async () => {}),
    executeJavaScript: vi.fn(page.forms ?? (async () => false)),
    executeJavaScriptInIsolatedWorld: vi.fn(page.picture ?? (async () => false))
  }
  return {
    id,
    url: `https://${id}.example/`,
    pinned: false,
    sleeping: false,
    loading: false,
    audible: false,
    pageLifecycleState: 'active',
    observationGeneration: 0,
    webContents
  }
}

type FakeTab = ReturnType<typeof tab>

/** The tab manager around the tabs, with the first one shown and nothing else keeping a tab awake. */
function manager(tabs: FakeTab[]) {
  const none = { active: () => false }
  const browser = {
    tabs: new Map(tabs.map((candidate) => [candidate.id, candidate])),
    mcpTabGroups: new Map(),
    activeTabId: tabs[0]!.id,
    splitViewContains: () => false,
    selectTab: vi.fn((tabId: string) => { browser.activeTabId = tabId }),
    options: {},
    devToolsOpening: new Set(),
    screenshotAreaSessions: new Map(),
    elementPickerSessions: new Map(),
    agentInputWebContents: new Map(),
    videoRecorder: { state: () => ({ status: 'idle' }) },
    cssStatePreview: none,
    domMutationSource: none,
    virtualPasskeys: none,
    logpoints: none,
    mcpActivitiesByTab: new Map(),
    downloadController: { hasActiveDownload: () => false },
    renderQueues: new Map()
  }
  return browser
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('what in the page keeps a tab awake', () => {
  it('names a video the page shows in Picture in picture, read in a world of its own', async () => {
    // Sleeping replaced the page, which closed the video's Picture in picture window, where Chrome never discards it.
    const shown = tab({ picture: async () => true })
    expect(await pageSleepHold(shown as never)).toBe('appErrors.sleep.pictureInPicture')
    expect(shown.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledExactlyOnceWith(ISOLATED_WORLDS.tabSleep, [{ code: expect.stringContaining('document.pictureInPictureElement != null') }])
  })

  it('names a video a frame inside the page shows, such as an embedded player', async () => {
    const quiet = frame(pictureInPicture(false))
    const player = frame(pictureInPicture(true))
    expect(await pageSleepHold(tab({}, [quiet, player]) as never)).toBe('appErrors.sleep.pictureInPicture')
    expect(quiet.executeJavaScript).toHaveBeenCalledTimes(2)
  })

  it('names changed form input before a video, and counts a page that cannot answer the form check as changed', async () => {
    expect(await pageSleepHold(tab({ forms: async () => true, picture: async () => true }) as never)).toBe('appErrors.sleep.unsavedForm')
    expect(await pageSleepHold(tab({}, [frame(async (code) => !code.includes('pictureInPictureElement'))]) as never)).toBe('appErrors.sleep.unsavedForm')
    expect(await pageSleepHold(tab({ forms: async () => { throw new Error('Script failed') } }) as never)).toBe('appErrors.sleep.unsavedForm')
    expect(await pageSleepHold(tab({ forms: async () => { throw new RendererExitedError(true) }, picture: async () => { throw new RendererExitedError(true) } }) as never)).toBeUndefined()
  })

  it('finds nothing when no frame says so, a frame is gone, or the page cannot answer about Picture in picture', async () => {
    const gone = frame(async () => true, { detached: true })
    expect(await pageSleepHold(tab({}, [frame(async () => false), gone]) as never)).toBeUndefined()
    expect(gone.executeJavaScript).not.toHaveBeenCalled()
    expect(await pageSleepHold(tab({ picture: async () => { throw new Error('Render frame was disposed') } }) as never)).toBeUndefined()
    expect(await pageSleepHold(tab({ picture: async () => 'yes' }) as never)).toBeUndefined()
  })

  it('asks the page both questions at once, so one it is slow to answer does not leave the other waiting behind it', async () => {
    let answerForms!: (changed: boolean) => void
    const page = tab({ forms: () => new Promise((resolve) => { answerForms = resolve }) })
    const hold = pageSleepHold(page as never)
    await vi.advanceTimersByTimeAsync(0)
    expect(page.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce()
    answerForms(false)
    expect(await hold).toBeUndefined()
  })

  it('gives each frame that never answers one wait for both questions', async () => {
    const silent = () => frame(() => new Promise(() => {}))
    const hold = pageSleepHold(tab({}, [silent(), silent(), frame(pictureInPicture(true))]) as never)
    let settled = false
    void hold.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(1_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await hold).toBe('appErrors.sleep.pictureInPicture')
  })
})

describe('putting a tab with a video in Picture in picture to sleep', () => {
  it('keeps the tab awake, telling the person who asked and leaving Memory Saver quiet', async () => {
    const shown = tab({ picture: async () => true }, [], 'player')
    const browser = manager([tab({}, [], 'shown'), shown])
    await expect(putTabToSleep(browser as never, shown as never, true)).rejects.toMatchObject({ key: 'appErrors.sleep.pictureInPicture' })
    expect(await putTabToSleep(browser as never, shown as never, false)).toBe(false)
    expect(shown.sleeping).toBe(false)
    expect(shown.webContents.loadURL).not.toHaveBeenCalled()
  })

  it('keeps the view on the tab the person put to sleep from its menu, without waking the tab beside it', async () => {
    const shown = tab({ picture: async () => true }, [], 'player')
    const browser = manager([shown, tab({}, [], 'beside')])
    await expect(setTabSleepingFromContextMenu(browser as never, 'player', true)).rejects.toMatchObject({ key: 'appErrors.sleep.pictureInPicture' })
    expect(browser.selectTab).not.toHaveBeenCalled()
    expect(browser.activeTabId).toBe('player')
    expect(shown.webContents.loadURL).not.toHaveBeenCalled()
  })
})
