import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ focused: null as unknown }))
vi.mock('electron', () => ({ webContents: { getFocusedWebContents: () => electron.focused } }))

// The browser below stubs changed, which focus moving into a page publishes with.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist)
}))

import { attachPageFocusEvents } from '../src/main/browser/tab-events/page-focus-events.js'

function covered(options: { agentInput?: boolean } = {}) {
  const shell = { focus: vi.fn() }
  const page = Object.assign(new EventEmitter(), { id: 7, isDestroyed: () => false })
  const tab = { id: 'tab', lastActiveAt: 0, sleeping: false }
  const browser = {
    restoringLayout: false,
    browserContentOccluded: true,
    agentInputWebContents: new Map(options.agentInput ? [[page.id, 1]] : []),
    window: { isDestroyed: () => false, isFocused: () => true, webContents: shell },
    wakeTab: vi.fn(),
    splitViewContains: () => false,
    activeTabId: tab.id,
    writeActiveTabId: vi.fn(),
    markTabActiveInGroup: vi.fn(),
    changed: vi.fn(),
    options: { onCoveredPageKeyboard: vi.fn() }
  }
  attachPageFocusEvents(browser as never, tab as never, page as never)
  return { browser, shell, page }
}

afterEach(() => { electron.focused = null })

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))

it('reports a page that takes the keyboard under trusted chrome, as when the person comes back to the window, and gives it to the shell', async () => {
  const { browser, shell, page } = covered()
  electron.focused = page
  page.emit('focus')
  await nextTurn()
  // A question over the page gives the keyboard back to it once it is answered.
  expect(browser.options.onCoveredPageKeyboard).toHaveBeenCalledExactlyOnceWith(page)
  expect(shell.focus).toHaveBeenCalledOnce()
})

it('reports nothing for a page whose focus moved on, or that an agent focused', async () => {
  const moved = covered()
  electron.focused = null
  moved.page.emit('focus')
  await nextTurn()
  expect(moved.browser.options.onCoveredPageKeyboard).not.toHaveBeenCalled()
  expect(moved.shell.focus).not.toHaveBeenCalled()

  const agent = covered({ agentInput: true })
  electron.focused = agent.page
  agent.page.emit('focus')
  await nextTurn()
  expect(agent.browser.options.onCoveredPageKeyboard).not.toHaveBeenCalled()
})
