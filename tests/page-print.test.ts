import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { printPage, printShownPage } from '../src/main/browser/page-print/page-print.js'
import { LocalizedError } from '../src/main/localized-error.js'

// Hronaut had no Print: Ctrl/Cmd+P did nothing, and neither the menu nor the page's context menu offered it, so a
// person could print a page or save it as PDF only through a button of the page's own.

type PrintCallback = (success: boolean, failureReason: string) => void

type PrintTab = Pick<BrowserTab, 'id' | 'url' | 'sleeping' | 'webContents'>

/** What the browser around the page says; each case below changes one thing. */
interface PrintState {
  shown?: boolean
  occluded?: boolean
  locked?: boolean
  agentInput?: boolean
  selecting?: boolean
  agentWorkingOn?: (tabId: string) => boolean
}

function harness(state: PrintState = {}, tabFields: Partial<PrintTab> = {}) {
  const callbacks: PrintCallback[] = []
  const print = vi.fn((_options: object, callback: PrintCallback) => { callbacks.push(callback) })
  const listeners = new Map<string, () => void>()
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    isCrashed: () => false,
    print,
    once: (event: string, listener: () => void) => { listeners.set(event, listener) },
    removeListener: (event: string, listener: () => void) => { if (listeners.get(event) === listener) listeners.delete(event) }
  } as unknown as WebContents
  const tab: PrintTab = { id: 'tab', url: 'https://docs.example/invoice', sleeping: false, webContents, ...tabFields }
  const printing = new Set<number>()
  const browser = {
    activeTabId: state.shown === false ? undefined : tab.id,
    tabs: new Map([[tab.id, tab]]),
    browserContentOccluded: state.occluded === true,
    isHumanInteractionLocked: () => state.locked === true,
    agentInputWebContents: new Map(state.agentInput ? [[7, 1]] : []),
    screenshotAreaSessions: new Map(state.selecting ? [[7, {}]] : []),
    elementPickerSessions: new Map(),
    options: { agentWorkingOnTab: (tabId: string) => state.agentWorkingOn?.(tabId) === true },
    pagePrinting: printing
  } as unknown as Browser
  return { browser, tab: tab as BrowserTab, print, callbacks, printing, listeners }
}

describe('printing a page', () => {
  it('opens the system print dialog for the shown page and resolves when it closes', async () => {
    const { browser, print, callbacks, printing } = harness()
    const printed = printShownPage(browser)
    expect(print).toHaveBeenCalledExactlyOnceWith({}, expect.any(Function))
    expect(printing.has(7)).toBe(true)
    callbacks[0]!(true, '')
    await expect(printed).resolves.toBeUndefined()
    expect(printing.size).toBe(0)
  })

  it('treats the person cancelling the dialog as done, not as a failure', async () => {
    const { browser, callbacks, printing } = harness()
    const printed = printShownPage(browser)
    callbacks[0]!(false, 'Print job canceled')
    await expect(printed).resolves.toBeUndefined()
    expect(printing.size).toBe(0)
  })

  it('reports a failed print in the interface language and can print again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { browser, print, callbacks } = harness()
    const printed = printShownPage(browser)
    callbacks[0]!(false, 'Print job failed')
    const failure = await printed.catch((reason: unknown) => reason)
    expect(failure).toBeInstanceOf(LocalizedError)
    expect((failure as LocalizedError).key).toBe('appErrors.page.printFailed')
    expect((failure as Error).message).toBe('Hronaut could not print this page.')
    void printShownPage(browser)
    expect(print).toHaveBeenCalledTimes(2)
    error.mockRestore()
  })

  it('opens one dialog at a time for a page', async () => {
    const { browser, print, callbacks } = harness()
    const first = printShownPage(browser)
    await expect(printShownPage(browser)).resolves.toBeUndefined()
    expect(print).toHaveBeenCalledOnce()
    callbacks[0]!(true, '')
    await first
    void printShownPage(browser)
    expect(print).toHaveBeenCalledTimes(2)
  })

  it('prints nothing while the dialog would hold a page the person or an agent is busy with', async () => {
    const cases: Array<[string, PrintState]> = [
      ['trusted chrome covers the pages', { occluded: true }],
      ['the human input lock holds the person\'s input back', { locked: true }],
      ['an agent is typing or clicking in the page', { agentInput: true }],
      ['an area screenshot or element pick is under way', { selecting: true }]
    ]
    for (const [, state] of cases) {
      const { browser, print, printing } = harness(state)
      await expect(printShownPage(browser)).resolves.toBeUndefined()
      expect(print).not.toHaveBeenCalled()
      expect(printing.size).toBe(0)
    }
  })

  it('prints nothing for Hronaut Home, a sleeping page, a page whose renderer is gone, or no shown tab', async () => {
    const home = harness({}, { url: 'hronaut://home/' })
    await printShownPage(home.browser)
    expect(home.print).not.toHaveBeenCalled()
    const sleeping = harness({}, { sleeping: true })
    await printShownPage(sleeping.browser)
    expect(sleeping.print).not.toHaveBeenCalled()
    const crashed = harness()
    ;(crashed.tab.webContents as unknown as { isCrashed: () => boolean }).isCrashed = () => true
    await printShownPage(crashed.browser)
    expect(crashed.print).not.toHaveBeenCalled()
    const destroyed = harness()
    ;(destroyed.tab.webContents as unknown as { isDestroyed: () => boolean }).isDestroyed = () => true
    await printShownPage(destroyed.browser)
    expect(destroyed.print).not.toHaveBeenCalled()
    const none = harness({ shown: false })
    await expect(printShownPage(none.browser)).resolves.toBeUndefined()
    expect(none.print).not.toHaveBeenCalled()
  })

  it('asks the person to take over or pause agents before printing a page an agent is working on', async () => {
    // The dialog would hold the page still, and the agent's next step would wait until the person closed it.
    const { browser, print, printing } = harness({ agentWorkingOn: (tabId) => tabId === 'tab' })
    const failure = await printShownPage(browser).catch((reason: unknown) => reason)
    expect(failure).toBeInstanceOf(LocalizedError)
    expect((failure as LocalizedError).key).toBe('appErrors.page.printAgentWorking')
    expect((failure as Error).message).toBe('An agent is working on this page. Take over or pause agents to print it.')
    expect(print).not.toHaveBeenCalled()
    expect(printing.size).toBe(0)
  })

  it('can print again when the page goes away before Electron answers', async () => {
    for (const event of ['render-process-gone', 'destroyed']) {
      const { browser, print, printing, listeners, callbacks } = harness()
      const printed = printShownPage(browser)
      listeners.get(event)!()
      await expect(printed).resolves.toBeUndefined()
      expect(printing.size).toBe(0)
      expect(listeners.size).toBe(0)
      // A late answer changes nothing.
      callbacks[0]!(false, 'Print job failed')
      void printShownPage(browser)
      expect(print).toHaveBeenCalledTimes(2)
    }
  })

  it('stops listening for the page going away once the dialog closes', async () => {
    const { browser, callbacks, listeners } = harness()
    const printed = printShownPage(browser)
    expect([...listeners.keys()].sort()).toEqual(['destroyed', 'render-process-gone'])
    callbacks[0]!(true, '')
    await printed
    expect(listeners.size).toBe(0)
  })

  it('prints the tab it is given, such as the pane a context menu opened on', async () => {
    const { browser, tab, print, callbacks } = harness({ shown: false })
    const printed = printPage(browser, tab)
    expect(print).toHaveBeenCalledOnce()
    callbacks[0]!(true, '')
    await printed
  })

  it('rejects when Electron refuses to start printing, and forgets the page', async () => {
    const { browser, tab, printing } = harness()
    ;(tab.webContents as unknown as { print: () => void }).print = () => { throw new Error('busy') }
    await expect(printShownPage(browser)).rejects.toThrow('busy')
    expect(printing.size).toBe(0)
  })
})
