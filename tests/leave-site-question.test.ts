import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const showMessageBoxSync = vi.fn<(window: unknown, options: Record<string, unknown>) => number>()
vi.mock('electron', () => ({ dialog: { showMessageBoxSync: (...args: [unknown, Record<string, unknown>]) => showMessageBoxSync(...args) } }))

const { attachLeaveSiteQuestion } = await import('../src/main/browser/tab-events/leave-site-question.js')

afterEach(() => {
  showMessageBoxSync.mockReset()
})

function setUp() {
  const webContents = Object.assign(new EventEmitter(), { id: 7 })
  const tab = { id: 'tab-1' }
  const window = { id: 'window' }
  const browser = {
    destroyed: false,
    window,
    tabs: new Map([[tab.id, tab]]),
    agentInputWebContents: new Map<number, number>(),
    text: (key: string) => `text:${key}`
  }
  attachLeaveSiteQuestion(browser as never, tab as never, webContents as never)
  const askToLeave = (): { left: boolean } => {
    const event = { left: false, preventDefault() { this.left = true } }
    webContents.emit('will-prevent-unload', event)
    return { left: event.left }
  }
  return { browser, webContents, window, askToLeave }
}

describe('Leave site question', () => {
  it('asks the person with the system message box and leaves the page when they choose Leave page', () => {
    const { window, askToLeave } = setUp()
    showMessageBoxSync.mockReturnValue(1)
    expect(askToLeave()).toEqual({ left: true })
    expect(showMessageBoxSync).toHaveBeenCalledTimes(1)
    expect(showMessageBoxSync).toHaveBeenCalledWith(window, expect.objectContaining({
      type: 'warning',
      title: 'text:native.dialog.leavePageTitle',
      message: 'text:native.dialog.leavePageMessage',
      detail: 'text:native.dialog.leavePageDetail',
      buttons: ['text:native.dialog.keepEditing', 'text:native.dialog.leavePage'],
      defaultId: 0,
      cancelId: 0
    }))
  })

  it('keeps the page when the person chooses Keep editing or closes the box', () => {
    const { askToLeave } = setUp()
    showMessageBoxSync.mockReturnValue(0)
    expect(askToLeave()).toEqual({ left: false })
  })

  it('leaves the answer to a Hronaut navigation or close that listens for the question itself', () => {
    const { webContents, askToLeave } = setUp()
    const own = vi.fn()
    webContents.on('will-prevent-unload', own)
    askToLeave()
    expect(own).toHaveBeenCalledTimes(1)
    expect(showMessageBoxSync).not.toHaveBeenCalled()
  })

  it('keeps the page without asking while an agent input runs on it', () => {
    const { browser, askToLeave } = setUp()
    browser.agentInputWebContents.set(7, 1)
    expect(askToLeave()).toEqual({ left: false })
    expect(showMessageBoxSync).not.toHaveBeenCalled()
  })

  it('does not ask for a tab that is closed or a browser that is going away', () => {
    const closed = setUp()
    closed.browser.tabs.clear()
    expect(closed.askToLeave()).toEqual({ left: false })
    const quitting = setUp()
    quitting.browser.destroyed = true
    expect(quitting.askToLeave()).toEqual({ left: false })
    expect(showMessageBoxSync).not.toHaveBeenCalled()
  })
})
