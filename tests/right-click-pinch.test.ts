import type { WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { click } from '../src/main/browser/agent-page-actions/click.js'
import type { Browser } from '../src/main/browser/browser.js'
import { dispatchNativeClick } from '../src/main/browser/native-click/native-click.js'

// The right-click runs with the agent's input, the tab's debugger, its environment and its admission already granted,
// and its pointer shown. The press reads the page's viewport again where the pointer went, through the sample.
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
vi.mock('../src/main/browser/owned-right-click.js', () => ({ assertRightClickPlatform: () => undefined }))
vi.mock('../src/main/browser/native-click/right-click-environment.js', () => ({
  rightClickEnvironment: () => ({ validate: () => undefined, dispose: () => undefined })
}))
const admissionSample = vi.hoisted(() => vi.fn(async (_x: number, _y: number) => undefined))
vi.mock('../src/main/browser/native-click-admission.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/native-click-admission.js')>(),
  acquireNativeClickAdmission: async () => ({ sample: admissionSample, dispose: async () => undefined })
}))
vi.mock('../src/main/browser/native-click/native-click.js', () => ({
  dispatchNativeClick: vi.fn(async (_browser: unknown, _webContents: unknown, point: { x: number; y: number }, _double: boolean,
    _validate: unknown, sample?: (x: number, y: number) => Promise<void>) => { await sample?.(point.x, point.y) })
}))

afterEach(() => {
  vi.mocked(dispatchNativeClick).mockClear()
  admissionSample.mockClear()
})

/** A tab at its normal scale until the pointer moved to its target, when a person pinches it to the scale given. */
function pinchedWhileMoving(scale: number, emulation: Record<string, unknown> = {}) {
  let reads = 0
  const webContents = {
    id: 1,
    getURL: () => 'https://example.test/',
    isLoadingMainFrame: () => true,
    executeJavaScript: vi.fn(async (script: string) => script.includes('__hronautAgentInputActive') ? true : { x: 10, y: 20, tag: 'button' }),
    debugger: {
      sendCommand: vi.fn(async (method: string) => {
        if (method !== 'Page.getLayoutMetrics') return {}
        const shown = ++reads === 1 ? 1 : scale
        return { cssVisualViewport: { clientWidth: 1009 / shown, clientHeight: 768 / shown, scale: shown, offsetX: shown > 1 ? 120 : 0, offsetY: 0 } }
      })
    }
  } as unknown as WebContents
  const tab = { id: 'tab-1', webContents, emulation }
  const browser = {
    tabs: new Map([['tab-1', tab]]),
    activeTabId: 'tab-1',
    openedTabObservations: new Map(),
    unconfirmedSemanticClicks: new Set()
  } as unknown as Browser
  return { browser }
}

const rightClick = { tabId: 'tab-1', selector: '#menu', native: true, button: 'right' } as const

// A pinch made while the pointer moved to the target refused the right-click as an uncertain outcome, which says
// nothing of the pinch, where a pinch found before the move says how to go on.
describe('a native right-click on a page pinched while its pointer moved', () => {
  it('is refused as a pinched page by the read before its press', async () => {
    const { browser } = pinchedWhileMoving(2)
    await expect(click(browser, rightClick)).rejects.toMatchObject({ reason: 'PAGE_PINCHED', progress: { downAttempted: 0 } })
    // The refusal came from the right-click's own read where the pointer went, before the page's sample of the target.
    expect(dispatchNativeClick).toHaveBeenCalledOnce()
    expect(vi.mocked(dispatchNativeClick).mock.calls[0]![7]).toBe(true)
    expect(admissionSample).not.toHaveBeenCalled()
  })

  it('right-clicks a page that stayed at its normal scale', async () => {
    const { browser } = pinchedWhileMoving(1)
    await expect(click(browser, rightClick)).resolves.toMatchObject({ ok: true, button: 'right' })
    expect(vi.mocked(dispatchNativeClick).mock.calls[0]![7]).toBe(true)
    expect(admissionSample).toHaveBeenCalledExactlyOnceWith(10, 20)
  })
})
