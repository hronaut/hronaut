import type { WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { click } from '../src/main/browser/agent-page-actions/click.js'
import type { Browser } from '../src/main/browser/browser.js'
import { dispatchNativeClick } from '../src/main/browser/native-click/native-click.js'

// The click runs with the agent's input, the tab's debugger and its admission already granted, and its pointer shown.
vi.mock('../src/main/browser/native-input-authority/native-input-authority.js', () => ({
  nativeInputAuthority: () => ({ validate: () => undefined, dispose: () => undefined })
}))
vi.mock('../src/main/browser/debugger-lease/debugger-lease.js', () => ({
  withDebugger: async (_browser: unknown, _webContents: unknown, operation: () => Promise<unknown>) => await operation()
}))
vi.mock('../src/main/browser/agent-input-scope/agent-input-scope.js', () => ({
  withAgentInput: async (_browser: unknown, _webContents: unknown, operation: () => Promise<unknown>) => await operation()
}))
vi.mock('../src/main/browser/agent-pointer/agent-pointer.js', () => ({ showAgentPointer: async () => undefined }))
vi.mock('../src/main/browser/native-click-admission.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/native-click-admission.js')>(),
  acquireNativeClickAdmission: async () => ({ sample: async () => undefined, dispose: async () => undefined })
}))
vi.mock('../src/main/browser/native-click/native-click.js', () => ({ dispatchNativeClick: vi.fn(async () => undefined) }))

afterEach(() => {
  vi.mocked(dispatchNativeClick).mockClear()
})

/** A tab whose page still reads its own document, shown at the scale and offset given. */
function loadingTab(scale: number, offsetX = 0, offsetY = 0) {
  const webContents = {
    id: 1,
    getURL: () => 'https://example.test/',
    isLoadingMainFrame: () => true,
    executeJavaScript: vi.fn(async (script: string) => script.includes('__hronautAgentInputActive') ? true : { x: 10, y: 20, tag: 'button' }),
    debugger: {
      sendCommand: vi.fn(async (method: string) => method === 'Page.getLayoutMetrics'
        ? { cssVisualViewport: { clientWidth: 1009 / scale, clientHeight: 768 / scale, scale, offsetX, offsetY } }
        : {})
    }
  } as unknown as WebContents
  const tab = { id: 'tab-1', webContents, emulation: {} }
  const browser = {
    tabs: new Map([['tab-1', tab]]),
    activeTabId: 'tab-1',
    openedTabObservations: new Map(),
    unconfirmedSemanticClicks: new Set()
  } as unknown as Browser
  return { browser }
}

// A page still reading its document is not asked before the click, and the press was refused only after the page
// scrolled to its target and the pointer's move went out, to the part of the page the pinch shows.
describe('a native click on a pinched page that still reads its document', () => {
  it('is refused before the page scrolls or the pointer moves', async () => {
    const { browser } = loadingTab(2, 200, 150)
    await expect(click(browser, { tabId: 'tab-1', selector: '#go', native: true })).rejects.toMatchObject({
      reason: 'PAGE_PINCHED', progress: { moveAttempted: 0, downAttempted: 0 }
    })
    expect(dispatchNativeClick).not.toHaveBeenCalled()
    // Nor was the page scrolled to its target, which would have panned the pinched view.
    const scripts = vi.mocked(browser.tabs.get('tab-1')!.webContents.executeJavaScript).mock.calls.map(([script]) => String(script))
    expect(scripts.filter((script) => script.includes('scrollIntoView'))).toEqual([])
  })

  it('clicks a page at its normal scale', async () => {
    const { browser } = loadingTab(1)
    await expect(click(browser, { tabId: 'tab-1', selector: '#go', native: true })).resolves.toMatchObject({ ok: true, native: true })
    expect(dispatchNativeClick).toHaveBeenCalledOnce()
  })
})
