import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ focused: null as unknown }))
vi.mock('electron', () => ({ webContents: { getFocusedWebContents: () => electron.focused } }))

import { attachPageFocusEvents } from '../src/main/browser/tab-events/page-focus-events.js'
import type { PageFocusEventsAccess, PageFocusEventsTab } from '../src/main/browser/tab-events/page-focus-events-access.js'

function covered(options: { agentInput?: boolean } = {}) {
  const shell = { focus: vi.fn() }
  const page = Object.assign(new EventEmitter(), { id: 7, isDestroyed: () => false })
  const tab: PageFocusEventsTab = { id: 'tab', lastActiveAt: 0, sleeping: false }
  const access = {
    restoringLayout: () => false,
    browserContentOccluded: () => true,
    agentInputWebContents: () => new Map(options.agentInput ? [[page.id, 1]] : []),
    window: () => ({ isDestroyed: () => false, isFocused: () => true, webContents: shell }),
    wakeTab: vi.fn(),
    splitViewContains: () => false,
    activeTabId: () => tab.id,
    writeActiveTabId: vi.fn(),
    markTabActiveInGroup: vi.fn(),
    changed: vi.fn(),
    coveredPageTookKeyboard: vi.fn()
  }
  attachPageFocusEvents(access as unknown as PageFocusEventsAccess<PageFocusEventsTab>, tab, page as never)
  return { access, shell, page }
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))

it('reports a page that takes the keyboard under trusted chrome, as when the person comes back to the window, and gives it to the shell', async () => {
  const { access, shell, page } = covered()
  electron.focused = page
  page.emit('focus')
  await nextTurn()
  // A question over the page gives the keyboard back to it once it is answered.
  expect(access.coveredPageTookKeyboard).toHaveBeenCalledExactlyOnceWith(page)
  expect(shell.focus).toHaveBeenCalledOnce()
  electron.focused = null
})

it('reports nothing for a page whose focus moved on, or that an agent focused', async () => {
  const moved = covered()
  electron.focused = null
  moved.page.emit('focus')
  await nextTurn()
  expect(moved.access.coveredPageTookKeyboard).not.toHaveBeenCalled()
  expect(moved.shell.focus).not.toHaveBeenCalled()

  const agent = covered({ agentInput: true })
  electron.focused = agent.page
  agent.page.emit('focus')
  await nextTurn()
  expect(agent.access.coveredPageTookKeyboard).not.toHaveBeenCalled()
  electron.focused = null
})
