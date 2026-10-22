import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { printPage, printShownPage } from '../src/main/browser/page-print/page-print.js'
import type { PagePrintAccess, PagePrintTab } from '../src/main/browser/page-print/page-print-access.js'
import { LocalizedError } from '../src/main/localized-error.js'

// Hronaut had no Print: Ctrl/Cmd+P did nothing, and neither the menu nor the page's context menu offered it, so a
// person could print a page or save it as PDF only through a button of the page's own.

type PrintCallback = (success: boolean, failureReason: string) => void

function harness(overrides: Partial<PagePrintAccess<PagePrintTab>> = {}, tabFields: Partial<PagePrintTab> = {}) {
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
  const tab: PagePrintTab = { id: 'tab', url: 'https://docs.example/invoice', sleeping: false, webContents, ...tabFields }
  const printing = new Set<number>()
  const access: PagePrintAccess<PagePrintTab> = {
    shownTab: () => tab,
    browserContentOccluded: () => false,
    isHumanInteractionLocked: () => false,
    agentInputWebContents: () => new Map(),
    agentWorkingOn: () => false,
    nativeSelectionUnderWay: () => false,
    printingWebContents: () => printing,
    ...overrides
  }
  return { access, tab, print, callbacks, printing, listeners }
}

describe('printing a page', () => {
  it('opens the system print dialog for the shown page and resolves when it closes', async () => {
    const { access, print, callbacks, printing } = harness()
    const printed = printShownPage(access)
    expect(print).toHaveBeenCalledExactlyOnceWith({}, expect.any(Function))
    expect(printing.has(7)).toBe(true)
    callbacks[0]!(true, '')
    await expect(printed).resolves.toBeUndefined()
    expect(printing.size).toBe(0)
  })

  it('treats the person cancelling the dialog as done, not as a failure', async () => {
    const { access, callbacks, printing } = harness()
    const printed = printShownPage(access)
    callbacks[0]!(false, 'Print job canceled')
    await expect(printed).resolves.toBeUndefined()
    expect(printing.size).toBe(0)
  })

  it('reports a failed print in the interface language and can print again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { access, print, callbacks } = harness()
    const printed = printShownPage(access)
    callbacks[0]!(false, 'Print job failed')
    const failure = await printed.catch((reason: unknown) => reason)
    expect(failure).toBeInstanceOf(LocalizedError)
    expect((failure as LocalizedError).key).toBe('appErrors.page.printFailed')
    expect((failure as Error).message).toBe('Hronaut could not print this page.')
    void printShownPage(access)
    expect(print).toHaveBeenCalledTimes(2)
    error.mockRestore()
  })

  it('opens one dialog at a time for a page', async () => {
    const { access, print, callbacks } = harness()
    const first = printShownPage(access)
    await expect(printShownPage(access)).resolves.toBeUndefined()
    expect(print).toHaveBeenCalledOnce()
    callbacks[0]!(true, '')
    await first
    void printShownPage(access)
    expect(print).toHaveBeenCalledTimes(2)
  })

  it('prints nothing while the dialog would hold a page the person or an agent is busy with', async () => {
    const cases: Array<[string, Partial<PagePrintAccess<PagePrintTab>>]> = [
      ['trusted chrome covers the pages', { browserContentOccluded: () => true }],
      ['the human input lock holds the person\'s input back', { isHumanInteractionLocked: () => true }],
      ['an agent is typing or clicking in the page', { agentInputWebContents: () => new Map([[7, 1]]) }],
      ['an area screenshot or element pick is under way', { nativeSelectionUnderWay: (id) => id === 7 }]
    ]
    for (const [, overrides] of cases) {
      const { access, print, printing } = harness(overrides)
      await expect(printShownPage(access)).resolves.toBeUndefined()
      expect(print).not.toHaveBeenCalled()
      expect(printing.size).toBe(0)
    }
  })

  it('prints nothing for Hronaut Home, a sleeping page, a page whose renderer is gone, or no shown tab', async () => {
    const home = harness({}, { url: 'hronaut://home/' })
    await printShownPage(home.access)
    expect(home.print).not.toHaveBeenCalled()
    const sleeping = harness({}, { sleeping: true })
    await printShownPage(sleeping.access)
    expect(sleeping.print).not.toHaveBeenCalled()
    const crashed = harness()
    ;(crashed.tab.webContents as unknown as { isCrashed: () => boolean }).isCrashed = () => true
    await printShownPage(crashed.access)
    expect(crashed.print).not.toHaveBeenCalled()
    const destroyed = harness()
    ;(destroyed.tab.webContents as unknown as { isDestroyed: () => boolean }).isDestroyed = () => true
    await printShownPage(destroyed.access)
    expect(destroyed.print).not.toHaveBeenCalled()
    const none = harness({ shownTab: () => undefined })
    await expect(printShownPage(none.access)).resolves.toBeUndefined()
    expect(none.print).not.toHaveBeenCalled()
  })

  it('asks the person to take over or pause agents before printing a page an agent is working on', async () => {
    // The dialog would hold the page still, and the agent's next step would wait until the person closed it.
    const { access, print, printing } = harness({ agentWorkingOn: (tab) => tab.id === 'tab' })
    const failure = await printShownPage(access).catch((reason: unknown) => reason)
    expect(failure).toBeInstanceOf(LocalizedError)
    expect((failure as LocalizedError).key).toBe('appErrors.page.printAgentWorking')
    expect((failure as Error).message).toBe('An agent is working on this page. Take over or pause agents to print it.')
    expect(print).not.toHaveBeenCalled()
    expect(printing.size).toBe(0)
  })

  it('can print again when the page goes away before Electron answers', async () => {
    for (const event of ['render-process-gone', 'destroyed']) {
      const { access, print, printing, listeners, callbacks } = harness()
      const printed = printShownPage(access)
      listeners.get(event)!()
      await expect(printed).resolves.toBeUndefined()
      expect(printing.size).toBe(0)
      expect(listeners.size).toBe(0)
      // A late answer changes nothing.
      callbacks[0]!(false, 'Print job failed')
      void printShownPage(access)
      expect(print).toHaveBeenCalledTimes(2)
    }
  })

  it('stops listening for the page going away once the dialog closes', async () => {
    const { access, callbacks, listeners } = harness()
    const printed = printShownPage(access)
    expect([...listeners.keys()].sort()).toEqual(['destroyed', 'render-process-gone'])
    callbacks[0]!(true, '')
    await printed
    expect(listeners.size).toBe(0)
  })

  it('prints the tab it is given, such as the pane a context menu opened on', async () => {
    const { access, tab, print, callbacks } = harness({ shownTab: () => undefined })
    const printed = printPage(access, tab)
    expect(print).toHaveBeenCalledOnce()
    callbacks[0]!(true, '')
    await printed
  })

  it('rejects when Electron refuses to start printing, and forgets the page', async () => {
    const { access, tab, printing } = harness()
    ;(tab.webContents as unknown as { print: () => void }).print = () => { throw new Error('busy') }
    await expect(printShownPage(access)).rejects.toThrow('busy')
    expect(printing.size).toBe(0)
  })
})
