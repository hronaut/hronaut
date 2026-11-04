import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'
import type { BrowserFindPageKey } from '../src/shared/types.js'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

const { clearFocusScript, forwardFindKeyToPage } = await import('../src/main/browser/page-find/find-page-keys.js')
type Browser = import('../src/main/browser/browser.js').Browser
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const NOW = 1_000_000
// Unfocusing only until the key goes without it.
const UNFOCUS = [ISOLATED_WORLDS.findPageKeys, [{ code: clearFocusScript(NOW + 300) }]]

function key(overrides: Partial<BrowserFindPageKey> = {}): BrowserFindPageKey {
  return { type: 'keyDown', key: 'ArrowDown', shift: false, control: false, alt: false, meta: false, repeat: false, ...overrides }
}

function findField(options: { active?: boolean; locked?: boolean; occluded?: boolean; agentInput?: boolean; selecting?: boolean; picking?: boolean } = {}) {
  const calls: string[] = []
  let destroyed = false
  const webContents = {
    id: 4,
    isDestroyed: () => destroyed,
    getURL: () => 'https://example.test/',
    isLoadingMainFrame: vi.fn(() => false),
    executeJavaScriptInIsolatedWorld: vi.fn(async () => { calls.push('unfocus') }),
    sendInputEvent: vi.fn((event: Electron.KeyboardInputEvent) => { calls.push(`${event.type} ${event.keyCode} ${event.modifiers?.join('+') ?? ''}`) })
  }
  const tab = { id: 'tab', locked: options.locked ?? false, webContents: webContents as unknown as WebContents }
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: options.active === false ? 'other' : 'tab',
    browserContentOccluded: options.occluded ?? false,
    isHumanInteractionLocked: (candidate: typeof tab) => candidate.locked,
    agentInputWebContents: new Map(options.agentInput ? [[4, 1]] : []),
    screenshotAreaSessions: new Map(options.selecting ? [[4, {}]] : []),
    elementPickerSessions: new Map(options.picking ? [[4, {}]] : [])
  } as unknown as Browser
  // Each key is sent after the page's script answers, so waiting for both empties the queue.
  const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  return { browser, tab, webContents, calls, settled, destroy: () => { destroyed = true } }
}

describe('sending a key from the Find field on to the page', () => {
  it('unfocuses the page\'s focused element in a world of its own, then sends the key as pressed, held or released', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const field = findField()
    forwardFindKeyToPage(field.browser, 'tab', key())
    forwardFindKeyToPage(field.browser, 'tab', key({ repeat: true }))
    forwardFindKeyToPage(field.browser, 'tab', key({ type: 'keyUp' }))
    forwardFindKeyToPage(field.browser, 'tab', key({ key: 'PageUp', shift: true, alt: true }))
    forwardFindKeyToPage(field.browser, 'tab', key({ key: 'End', control: true, meta: true }))
    forwardFindKeyToPage(field.browser, 'tab', key({ key: 'ArrowUp' }))
    forwardFindKeyToPage(field.browser, 'tab', key({ key: 'PageDown' }))
    forwardFindKeyToPage(field.browser, 'tab', key({ key: 'Home', control: true }))
    await field.settled()
    expect(field.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(...UNFOCUS)
    // In the order pressed: a released key waits for the key before it, which waits for the page to unfocus.
    expect(field.calls).toEqual([
      'unfocus', 'keyDown Down ',
      'unfocus', 'keyDown Down isautorepeat',
      'keyUp Down ',
      'unfocus', 'keyDown PageUp shift+alt',
      'unfocus', 'keyDown End control+meta',
      'unfocus', 'keyDown Up ',
      'unfocus', 'keyDown PageDown ',
      'unfocus', 'keyDown Home control'
    ])
  })

  it.each([
    ['in a tab not in view', { active: false }],
    ['behind trusted chrome', { occluded: true }],
    ['whose input is locked', { locked: true }],
    ['an agent is sending input to', { agentInput: true }],
    ['with an area capture in progress', { selecting: true }],
    ['with an element pick in progress', { picking: true }]
  ])('sends nothing to a page %s, as the person\'s own key there reaches nothing', async (_case, options) => {
    const field = findField(options)
    forwardFindKeyToPage(field.browser, 'tab', key())
    forwardFindKeyToPage(field.browser, 'tab', key({ type: 'keyUp' }))
    await field.settled()
    expect(field.calls).toEqual([])
  })

  it('sends nothing once the page went, or a lock took it, while its element was unfocused', async () => {
    const field = findField()
    field.webContents.executeJavaScriptInIsolatedWorld.mockImplementationOnce(async () => { field.calls.push('unfocus'); field.tab.locked = true })
    forwardFindKeyToPage(field.browser, 'tab', key())
    await field.settled()
    field.tab.locked = false
    field.webContents.executeJavaScriptInIsolatedWorld.mockImplementationOnce(async () => { field.calls.push('unfocus'); field.destroy() })
    forwardFindKeyToPage(field.browser, 'tab', key())
    await field.settled()
    expect(field.calls).toEqual(['unfocus', 'unfocus'])
  })

  it('leaves the page\'s element focused for a key whose turn came once a lock took the page', async () => {
    const field = findField()
    let unfocused!: () => void
    field.webContents.executeJavaScriptInIsolatedWorld.mockImplementationOnce(() => new Promise((resolve) => {
      unfocused = () => { field.calls.push('unfocus'); resolve(undefined) }
    }))
    forwardFindKeyToPage(field.browser, 'tab', key())
    forwardFindKeyToPage(field.browser, 'tab', key({ repeat: true }))
    await field.settled()
    field.tab.locked = true
    unfocused()
    await field.settled()
    expect(field.calls).toEqual(['unfocus'])
  })

  it('sends the release of a key to the page its press reached, also once a lock took it or another tab is in view', async () => {
    const field = findField()
    forwardFindKeyToPage(field.browser, 'tab', key({ key: 'PageDown' }))
    forwardFindKeyToPage(field.browser, 'tab', key({ key: 'ArrowUp' }))
    await field.settled()
    field.tab.locked = true
    forwardFindKeyToPage(field.browser, 'tab', key({ type: 'keyUp', key: 'PageDown', control: true }))
    field.browser.activeTabId = 'other'
    forwardFindKeyToPage(field.browser, 'tab', key({ type: 'keyUp', key: 'ArrowUp' }))
    await field.settled()
    expect(field.calls).toEqual(['unfocus', 'keyDown PageDown ', 'unfocus', 'keyDown Up ', 'keyUp PageDown control', 'keyUp Up '])
  })

  it('sends no release for a key the page did not get pressed, or got released already', async () => {
    const field = findField()
    forwardFindKeyToPage(field.browser, 'tab', key({ type: 'keyUp' }))
    forwardFindKeyToPage(field.browser, 'tab', key())
    forwardFindKeyToPage(field.browser, 'tab', key({ type: 'keyUp' }))
    forwardFindKeyToPage(field.browser, 'tab', key({ type: 'keyUp' }))
    await field.settled()
    expect(field.calls).toEqual(['unfocus', 'keyDown Down ', 'keyUp Down '])
  })

  it('sends the key without unfocusing while the page cannot run a script now, or once the script failed', async () => {
    const field = findField()
    field.webContents.isLoadingMainFrame.mockReturnValue(true)
    forwardFindKeyToPage(field.browser, 'tab', key())
    await field.settled()
    field.webContents.isLoadingMainFrame.mockReturnValue(false)
    field.webContents.executeJavaScriptInIsolatedWorld.mockRejectedValueOnce(new Error('Page went away'))
    forwardFindKeyToPage(field.browser, 'tab', key({ key: 'PageDown' }))
    await field.settled()
    expect(field.calls).toEqual(['keyDown Down ', 'keyDown PageDown '])
  })

  it('sends the key anyway once a page slow to run the script has had a moment', async () => {
    vi.useFakeTimers()
    const field = findField()
    field.webContents.executeJavaScriptInIsolatedWorld.mockReturnValueOnce(new Promise(() => undefined))
    forwardFindKeyToPage(field.browser, 'tab', key())
    await vi.advanceTimersByTimeAsync(299)
    expect(field.webContents.sendInputEvent).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(field.calls).toEqual(['keyDown Down '])
    expect(vi.getTimerCount()).toBe(0)
  })
})
