import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ webContents: { getFocusedWebContents: () => null } }))

const { cancelElementPicker, pickElement } = await import('../src/main/browser/element-picker/element-picker.js')
const { cancelScreenshotArea, captureScreenshotArea } = await import('../src/main/browser/screenshot-area/screenshot-area.js')
const { cancelElementPickerScript, cancelScreenshotAreaScript, elementPickerScript, screenshotAreaScript } = await import('../src/main/browser/page-scripts.js')
const { guardPageCallsDuringPrintDialog } = await import('../src/main/browser/print-dialog-guard.js')
const { guardPageCallsDuringWebsiteDialog } = await import('../src/main/browser/website-dialog-guard.js')
const { PAGE_IPC } = await import('../src/shared/ipc/page.js')

const SCRIPT_NAMES = new Map([
  [elementPickerScript(), 'pick'],
  [cancelElementPickerScript(), 'cancel pick'],
  [screenshotAreaScript(), 'select area'],
  [cancelScreenshotAreaScript(), 'cancel area']
])

/** A browser with one website tab whose page the dialog guards hold, recording the scripts that reach the page. */
function browserWithGuardedTab() {
  const scripts: string[] = []
  const debuggerEvents = new EventEmitter()
  const page = Object.assign(new EventEmitter(), {
    id: 7,
    mainFrame: { processId: 4, routingId: 1 },
    isDestroyed: () => false,
    // A pick or selection waits for the person; removing an overlay answers whether it was there.
    executeJavaScript: vi.fn((code: string) => {
      const name = SCRIPT_NAMES.get(code) ?? code
      scripts.push(name)
      return name.startsWith('cancel') ? Promise.resolve(true) : new Promise(() => undefined)
    }),
    executeJavaScriptInIsolatedWorld: vi.fn(async () => undefined),
    capturePage: vi.fn(async () => undefined),
    printToPDF: vi.fn(async () => Buffer.alloc(0)),
    debugger: Object.assign(debuggerEvents, { sendCommand: vi.fn(async () => ({})) })
  })
  guardPageCallsDuringPrintDialog(page as never)
  guardPageCallsDuringWebsiteDialog(page as never, () => false)
  const tab = { id: 'tab', url: 'https://example.test/', webContents: page, nativeInputEnvironmentGeneration: 0 }
  const browser = {
    activeTabId: tab.id,
    tabs: new Map([[tab.id, tab]]),
    elementPickerSessions: new Map(),
    screenshotAreaSessions: new Map(),
    isHumanInteractionLocked: () => false
  }
  const print = (open: boolean): void => { page.emit('ipc-message', { senderFrame: page.mainFrame }, PAGE_IPC.printDialog, open) }
  const alertOpens = async (): Promise<void> => {
    debuggerEvents.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'alert', message: 'Saved' })
    await new Promise(resolve => setImmediate(resolve))
  }
  const alertCloses = (): void => { debuggerEvents.emit('message', {}, 'Page.javascriptDialogClosed', { result: true }) }
  return { browser: browser as never, scripts, print, alertOpens, alertCloses }
}

// A pick or area selection canceled while the page's print dialog or alert held the page left Hronaut's overlay on the
// page once the dialog closed, with nothing behind it, so the page took no clicks until the person pressed Escape.
describe('removing a pick or area overlay while a dialog holds the page', () => {
  it('removes the element picker\'s overlay once the print dialog closes', async () => {
    const { browser, scripts, print } = browserWithGuardedTab()
    const pick = pickElement(browser, 'tab')
    await vi.waitFor(() => expect(scripts).toEqual(['pick']))
    print(true)
    await expect(cancelElementPicker(browser, 'tab')).resolves.toBe(false)
    await expect(pick).resolves.toEqual({ canceled: true })
    expect(scripts).toEqual(['pick'])

    print(false)
    await vi.waitFor(() => expect(scripts).toContain('cancel pick'))
    expect(new Set(scripts)).toEqual(new Set(['pick', 'cancel pick']))
  })

  it('leaves the overlay to a pick started before the dialog closed', async () => {
    const { browser, scripts, print } = browserWithGuardedTab()
    const first = pickElement(browser, 'tab')
    await vi.waitFor(() => expect(scripts).toEqual(['pick']))
    print(true)
    await cancelElementPicker(browser, 'tab')
    await expect(first).resolves.toEqual({ canceled: true })
    // The newer pick waits for the person through the dialog, and its script replaces the earlier overlay.
    void pickElement(browser, 'tab')
    await vi.waitFor(() => expect(scripts).toEqual(['pick', 'pick']))

    print(false)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(scripts).toEqual(['pick', 'pick'])
  })

  it('removes the area selection\'s overlay once a website alert is answered', async () => {
    const { browser, scripts, alertOpens, alertCloses } = browserWithGuardedTab()
    const capture = captureScreenshotArea(browser, 'tab')
    await vi.waitFor(() => expect(scripts).toEqual(['select area']))
    await alertOpens()
    await expect(cancelScreenshotArea(browser, 'tab')).resolves.toBe(false)
    await expect(capture).resolves.toEqual({ canceled: true })
    expect(scripts).toEqual(['select area'])

    alertCloses()
    await vi.waitFor(() => expect(scripts).toContain('cancel area'))
  })
})
