import { EventEmitter } from 'node:events'
import type { IpcMainEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({
  session: {},
  WebContentsView: class {},
  nativeImage: {},
  shell: {},
  app: { getPath: () => '/tmp' },
  powerMonitor: { on: () => undefined },
  webContents: { getFocusedWebContents: () => null }
}))
// The fake browser below stubs changed and getState, which selecting a tab publishes and returns through these.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: () => void }) => browser.changed(),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))
import { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { registerShellIpc } from '../src/main/shell-ipc.js'

type Listener = (event: IpcMainEvent, ...args: unknown[]) => void

/**
 * A window with two website tabs, the first shown with its page holding the keyboard. What takes the keyboard, and what
 * main tells the shell, is recorded in order.
 */
function fixture() {
  const events: string[] = []
  let keyboard = 'first'
  let windowFocused = true
  const shell = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: () => false,
    isFocused: () => keyboard === 'shell',
    focus: vi.fn(() => { keyboard = 'shell'; events.push('shell takes the keyboard') }),
    send: vi.fn((channel: string, ...args: unknown[]) => { events.push(`${channel} ${args.join(' ')}`) })
  })
  const page = (id: string, number: number) => ({
    id,
    url: `https://example.test/${id}`,
    sleeping: false,
    lastActiveAt: 0,
    humanInteractionLocked: false,
    view: { id: `view-${id}` },
    webContents: {
      id: number,
      isDestroyed: () => false,
      focus: vi.fn(() => { keyboard = id; events.push(`${id} page takes the keyboard`) })
    }
  })
  const tabs = new Map([['first', page('first', 2)], ['second', page('second', 3)]])
  const manager = Object.assign(Object.create(Browser.prototype), {
    destroyed: false,
    tabs,
    mcpTabGroups: new Map(),
    webContentsToTab: new Map([[2, 'first'], [3, 'second']]),
    activeTabId: 'first',
    splitView: null,
    tabSelectionGeneration: 0,
    window: {
      isDestroyed: () => false,
      isFocused: () => windowFocused,
      webContents: shell,
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }
    },
    browserContentOccluded: false,
    allHumanInteractionLocked: false,
    globallyUnlockedTabIds: new Set(),
    agentInputWebContents: new Map(),
    shellTabField: null,
    layout: vi.fn(),
    changed: vi.fn(),
    getState: () => ({})
  }) as Browser

  // The shell saying which of the shown tab's fields has the keyboard, as it does over IPC.
  const listeners = new Map<string, Listener>()
  registerShellIpc({ on: (channel: string, listener: Listener) => { listeners.set(channel, listener) }, handle: vi.fn() } as never, {
    handleBrowserIpc: vi.fn(),
    assertMainShellSender: vi.fn(),
    workspaceStartupFailure: () => undefined,
    tabs: () => manager
  } as never)
  const fieldFocused = (field: unknown) => listeners.get('shell:tab-field-focused')!({ sender: shell } as unknown as IpcMainEvent, field)
  /** The person gives a field of the shown tab the keyboard. */
  const focusField = (field: 'address' | 'find') => {
    keyboard = 'shell'
    fieldFocused(field)
  }
  const tab = (id: string) => tabs.get(id) as unknown as BrowserTab
  return {
    manager,
    events,
    tab,
    focusField,
    fieldFocused,
    keyboard: () => keyboard,
    leaveWindow: () => { windowFocused = false },
    takeEvents: () => events.splice(0)
  }
}

describe('the keyboard on coming back to a tab', () => {
  it('goes back to the field that had it when the tab was left, telling the shell first, and to the page of a tab left in its page', () => {
    const { manager, takeEvents, focusField, tab, keyboard } = fixture()
    focusField('address')
    manager.selectTab('second')
    // The second tab was never left with a field.
    expect(takeEvents()).toEqual(['second page takes the keyboard'])
    expect(tab('first').fieldFocusOnReturn).toBe('address')

    manager.selectTab('first')
    // The shell knows to give the address field the keyboard before it has it, so its suggestions stay closed.
    expect(takeEvents()).toEqual(['shell:tab-field-focus-returned first address', 'shell takes the keyboard'])
    expect(keyboard()).toBe('shell')
    // Left in its page, the second tab gives its page the keyboard next time.
    expect(tab('second').fieldFocusOnReturn).toBeUndefined()
    expect(tab('first').fieldFocusOnReturn).toBeUndefined()

    focusField('find')
    manager.selectTab('second')
    manager.selectTab('first')
    expect(takeEvents()).toEqual([
      'second page takes the keyboard',
      'shell:tab-field-focus-returned first find',
      'shell takes the keyboard'
    ])
  })

  it('leaves the page the keyboard of a tab left while the shell had it in no field of the tab', () => {
    const { manager, takeEvents, focusField, fieldFocused, tab } = fixture()
    focusField('address')
    // Such as a click on a tab, which takes the keyboard to the tab in the tab strip first.
    fieldFocused(null)
    manager.selectTab('second')
    manager.selectTab('first')
    expect(takeEvents()).toEqual(['second page takes the keyboard', 'first page takes the keyboard'])
    expect(tab('first').fieldFocusOnReturn).toBeUndefined()
  })

  it('gives no field back to a tab shown while trusted chrome covers the pages, the person is in another window, the tab is locked or an agent types in its page, and keeps none for later', () => {
    for (const reason of ['covered', 'other window', 'locked', 'agent input'] as const) {
      const { manager, takeEvents, focusField, tab, leaveWindow } = fixture()
      focusField('address')
      manager.selectTab('second')
      takeEvents()
      if (reason === 'covered') (manager as unknown as { browserContentOccluded: boolean }).browserContentOccluded = true
      if (reason === 'other window') leaveWindow()
      if (reason === 'locked') (tab('first') as unknown as { humanInteractionLocked: boolean }).humanInteractionLocked = true
      if (reason === 'agent input') manager.agentInputWebContents.set(tab('first').webContents.id, 1)
      manager.selectTab('first')
      expect(takeEvents().filter((event) => event.startsWith('shell:tab-field-focus-returned')), reason).toEqual([])
      // Kept, it would take the keyboard from the page the next time the tab is selected.
      expect(tab('first').fieldFocusOnReturn, reason).toBeUndefined()
    }
  })

  it('gives no field back to a tab selected again or shown without the keyboard', () => {
    const { manager, takeEvents, focusField, tab } = fixture()
    focusField('address')
    manager.selectTab('second')
    // Such as an agent showing the tab, which leaves the keyboard where it is.
    manager.selectTab('first', { focus: false })
    expect(tab('first').fieldFocusOnReturn).toBeUndefined()
    takeEvents()

    tab('first').fieldFocusOnReturn = 'find'
    manager.selectTab('first')
    expect(takeEvents()).toEqual(['first page takes the keyboard'])
    expect(tab('first').fieldFocusOnReturn).toBeUndefined()
  })

  it('keeps no field for a tab left while the person is in another window', () => {
    const { manager, focusField, tab, leaveWindow } = fixture()
    focusField('address')
    leaveWindow()
    manager.selectTab('second')
    expect(tab('first').fieldFocusOnReturn).toBeUndefined()
  })

  it('takes only the shell\'s own fields from the shell', () => {
    const { manager, fieldFocused } = fixture()
    for (const field of ['page', '', 1, undefined]) {
      expect(() => fieldFocused(field)).toThrow('Invalid tab field')
    }
    fieldFocused('find')
    expect(manager.shellTabField).toBe('find')
    fieldFocused(null)
    expect(manager.shellTabField).toBeNull()
  })
})
