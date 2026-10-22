import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'

const built = vi.hoisted(() => ({ menus: [] as Array<{ template: MenuItemConstructorOptions[]; popup: unknown[] }> }))
vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      const menu = { template, popup: [] as unknown[] }
      built.menus.push(menu)
      return { popup: (options: unknown) => { menu.popup.push(options) } }
    }
  }
}))

const { HISTORY_MENU_PAGES, historyMenuLabel, showHistoryMenu } = await import('../src/main/browser/context-menus/history-menu.js')
const { goToHistoryEntry } = await import('../src/main/browser/page-navigation/page-navigation.js')
const { registerNavigationIpc } = await import('../src/main/navigation-ipc.js')

type Entry = { url: string; title: string }

function historyOf(entries: Entry[], activeIndex: number) {
  const history = {
    entries,
    activeIndex,
    getAllEntries: () => history.entries,
    getActiveIndex: () => history.activeIndex,
    goToIndex: vi.fn((index: number) => { history.activeIndex = index })
  }
  return history
}

function setup(entries: Entry[], activeIndex: number, tabFields: { sleeping?: boolean; wakePromise?: Promise<void> } = {}) {
  const history = historyOf(entries, activeIndex)
  const tab = { id: 'tab-1', sleeping: false, ...tabFields, webContents: { isDestroyed: () => false, navigationHistory: history } }
  const send = vi.fn()
  const goTo = vi.fn(() => ({}) as never)
  const onActionFailed = vi.fn()
  const access = {
    findTab: (id: string) => id === tab.id ? tab : undefined,
    text: (key: string) => key,
    onActionFailed,
    goToHistoryEntry: goTo,
    window: () => ({ webContents: { send, getZoomFactor: () => 1.25 } })
  }
  return { tab, history, send, goTo, onActionFailed, access: access as never }
}

const pages = (count: number): Entry[] => Array.from({ length: count }, (_value, index) => ({ url: `https://site.test/${index}`, title: `Page ${index}` }))

function shown() {
  const menu = built.menus.at(-1)!
  return { menu, labels: menu.template.map((item) => item.type === 'separator' ? '---' : item.label) }
}

describe('the list of pages Back and Forward go through', () => {
  it('lists the pages Back goes through, nearest first, then Show Full History, below the arrow', () => {
    const { access } = setup(pages(4), 3)
    showHistoryMenu(access, 'tab-1', 'back', { x: 10, y: 40 })
    const { menu, labels } = shown()
    expect(labels).toEqual(['Page 2', 'Page 1', 'Page 0', '---', 'native.context.showFullHistory'])
    // The anchor is in the shell's CSS pixels, which its interface scale zooms.
    expect(menu.popup).toEqual([{ window: expect.anything(), x: 13, y: 50 }])
  })

  it('lists the pages Forward goes through, and opens at the pointer without an anchor', () => {
    const { access } = setup(pages(4), 1)
    showHistoryMenu(access, 'tab-1', 'forward')
    const { menu, labels } = shown()
    expect(labels).toEqual(['Page 2', 'Page 3', '---', 'native.context.showFullHistory'])
    expect(menu.popup).toEqual([{ window: expect.anything() }])
  })

  it('lists as many pages as Chrome does', () => {
    const { access } = setup(pages(30), 29)
    showHistoryMenu(access, 'tab-1', 'back')
    const { labels } = shown()
    expect(labels).toHaveLength(HISTORY_MENU_PAGES + 2)
    expect(labels[0]).toBe('Page 28')
    expect(labels[HISTORY_MENU_PAGES - 1]).toBe('Page 17')
  })

  it('names a page without a title by its address, and shows a title as written', () => {
    const { access } = setup([{ url: 'https://untitled.test/', title: '  ' }, { url: 'https://a.test/', title: 'Tom & Jerry' }, { url: 'https://b.test/', title: 'Now' }], 2)
    showHistoryMenu(access, 'tab-1', 'back')
    // A single & would mark an access key and disappear from the label.
    expect(shown().labels.slice(0, 2)).toEqual(['Tom && Jerry', 'https://untitled.test/'])
  })

  it('shortens a long title and folds its white space', () => {
    expect(historyMenuLabel(`A\n\tlong   ${'title '.repeat(30)}`)).toMatch(/^A long title title .{40,}…$/)
    expect(Array.from(historyMenuLabel('é'.repeat(200)))).toHaveLength(70)
    expect(historyMenuLabel('Short')).toBe('Short')
  })

  it('makes a label from the start of a page\'s very long address alone', () => {
    // A page can give its history entries addresses megabytes long; the label still ends where a shortened one does.
    expect(historyMenuLabel(`https://site.test/${'a'.repeat(2_000_000)}`)).toBe(`https://site.test/${'a'.repeat(51)}…`)
    // White space the bound kept folds as usual, and a label that the bound cut always ends in an ellipsis.
    expect(historyMenuLabel(`${' '.repeat(1_200)}Title`)).toBe('…')
    expect(historyMenuLabel(`Title${' '.repeat(1_200)}x`)).toBe('Title…')
    expect(historyMenuLabel(`${'😀'.repeat(499)}x${'😀'.repeat(10)}`)).toBe(`${'😀'.repeat(69)}…`)
  })

  it('shows nothing when there is no page that way, or the tab sleeps, is waking or is gone, and says so', () => {
    const before = built.menus.length
    expect([
      showHistoryMenu(setup(pages(3), 0).access, 'tab-1', 'back'),
      showHistoryMenu(setup(pages(3), 2).access, 'tab-1', 'forward'),
      showHistoryMenu(setup(pages(3), 2, { sleeping: true }).access, 'tab-1', 'back'),
      showHistoryMenu(setup(pages(3), 2, { wakePromise: Promise.resolve() }).access, 'tab-1', 'back'),
      showHistoryMenu(setup(pages(3), 2).access, 'other-tab', 'back')
    ]).toEqual([false, false, false, false, false])
    expect(built.menus.length).toBe(before)
    expect(showHistoryMenu(setup(pages(3), 2).access, 'tab-1', 'back')).toBe(true)
  })

  it('goes to the picked page as the history stood when the list opened', () => {
    const { access, goTo } = setup(pages(4), 3)
    showHistoryMenu(access, 'tab-1', 'back')
    const item = shown().menu.template.find((candidate) => candidate.label === 'Page 1')!
    ;(item.click as () => void)()
    expect(goTo).toHaveBeenCalledExactlyOnceWith('tab-1', { index: 1, url: 'https://site.test/1', activeIndex: 3 })
  })

  it('asks the window for the history panel from Show Full History', () => {
    const { access, send, goTo } = setup(pages(2), 1)
    showHistoryMenu(access, 'tab-1', 'back')
    const item = shown().menu.template.find((candidate) => candidate.id === 'show-full-history')!
    ;(item.click as () => void)()
    expect(send).toHaveBeenCalledExactlyOnceWith('browser:visit-history-requested')
    expect(goTo).not.toHaveBeenCalled()
  })

  it('reports a page it could not go to', () => {
    const { access, goTo, onActionFailed } = setup(pages(2), 1)
    const failure = new Error('gone')
    goTo.mockImplementation(() => { throw failure })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    showHistoryMenu(access, 'tab-1', 'back')
    ;(shown().menu.template[0]!.click as () => void)()
    expect(onActionFailed).toHaveBeenCalledWith('go to a page in the tab history', failure)
    logged.mockRestore()
  })
})

describe('going to a page picked from the list', () => {
  function navigation(entries: Entry[], activeIndex: number,
    options: { mcpGroupId?: string; allowed?: boolean; sleeping?: boolean; wakePromise?: Promise<void>; destroyed?: boolean } = {}) {
    const history = historyOf(entries, activeIndex)
    const tab = {
      id: 'tab-1', mcpGroupId: options.mcpGroupId, sleeping: options.sleeping ?? false, wakePromise: options.wakePromise,
      webContents: { isDestroyed: () => options.destroyed ?? false, navigationHistory: history }
    }
    const prepareDiagnosticNavigation = vi.fn()
    const workspaceNavigationAllowed = vi.fn(() => options.allowed ?? true)
    const access = {
      findTab: (id: string) => id === tab.id ? tab : undefined,
      workspaceNavigationAllowed,
      prepareDiagnosticNavigation,
      getState: () => ({ tabs: [] })
    }
    return { history, prepareDiagnosticNavigation, workspaceNavigationAllowed, access: access as never }
  }

  it('goes straight to the page', () => {
    const { access, history, prepareDiagnosticNavigation } = navigation(pages(4), 3)
    goToHistoryEntry(access, 'tab-1', { index: 1, url: 'https://site.test/1', activeIndex: 3 })
    expect(history.goToIndex).toHaveBeenCalledExactlyOnceWith(1)
    expect(prepareDiagnosticNavigation).toHaveBeenCalledOnce()
  })

  it('goes nowhere once the tab moved in its history or its history changed', () => {
    const moved = navigation(pages(4), 2)
    goToHistoryEntry(moved.access, 'tab-1', { index: 1, url: 'https://site.test/1', activeIndex: 3 })
    const replaced = navigation([...pages(1), { url: 'https://other.test/', title: 'Other' }, ...pages(4).slice(2)], 3)
    goToHistoryEntry(replaced.access, 'tab-1', { index: 1, url: 'https://site.test/1', activeIndex: 3 })
    const shortened = navigation(pages(2), 1)
    goToHistoryEntry(shortened.access, 'tab-1', { index: 5, url: 'https://site.test/5', activeIndex: 1 })
    const asleep = navigation(pages(4), 3, { sleeping: true })
    goToHistoryEntry(asleep.access, 'tab-1', { index: 1, url: 'https://site.test/1', activeIndex: 3 })
    goToHistoryEntry(asleep.access, 'closed-tab', { index: 1, url: 'https://site.test/1', activeIndex: 3 })
    const waking = navigation(pages(4), 3, { wakePromise: Promise.resolve() })
    goToHistoryEntry(waking.access, 'tab-1', { index: 1, url: 'https://site.test/1', activeIndex: 3 })
    const destroyed = navigation(pages(4), 3, { destroyed: true })
    goToHistoryEntry(destroyed.access, 'tab-1', { index: 1, url: 'https://site.test/1', activeIndex: 3 })
    for (const { history, prepareDiagnosticNavigation } of [moved, replaced, shortened, asleep, waking, destroyed]) {
      expect(history.goToIndex).not.toHaveBeenCalled()
      expect(prepareDiagnosticNavigation).not.toHaveBeenCalled()
    }
  })

  it('keeps to the workspace\'s sites, as Back does', () => {
    const denied = navigation(pages(4), 3, { mcpGroupId: 'client', allowed: false })
    goToHistoryEntry(denied.access, 'tab-1', { index: 0, url: 'https://site.test/0', activeIndex: 3 })
    expect(denied.workspaceNavigationAllowed).toHaveBeenCalledWith('client', 'https://site.test/0', 'history')
    expect(denied.history.goToIndex).not.toHaveBeenCalled()
    expect(denied.prepareDiagnosticNavigation).not.toHaveBeenCalled()
    const allowed = navigation(pages(4), 3, { mcpGroupId: 'client', allowed: true })
    goToHistoryEntry(allowed.access, 'tab-1', { index: 0, url: 'https://site.test/0', activeIndex: 3 })
    expect(allowed.history.goToIndex).toHaveBeenCalledWith(0)
  })
})

describe('the history list request from the shell', () => {
  function handler() {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    const showHistoryMenu = vi.fn(() => true)
    const assertTrustedSender = vi.fn()
    registerNavigationIpc({
      assertTrustedSender,
      handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as never) },
      tabs: () => ({ showHistoryMenu }) as never,
      defaultPdfPageSize: () => 'A4'
    })
    const listener = handlers.get('browser:show-history-menu')!
    return { show: (options: unknown) => listener({} as IpcMainInvokeEvent, options), showHistoryMenu, assertTrustedSender }
  }

  it('passes on a tab, a direction and a place on the window', () => {
    const { show, showHistoryMenu, assertTrustedSender } = handler()
    expect(show({ tabId: 'tab-1', direction: 'back', anchor: { x: 12, y: 72 } })).toBe(true)
    show({ tabId: 'tab-1', direction: 'forward' })
    show({ tabId: 'tab-1', direction: 'forward', anchor: { x: Number.NaN, y: 2 } })
    show({ tabId: 'tab-1', direction: 'forward', anchor: { x: -5, y: 2 } })
    show({ tabId: 'tab-1', direction: 'forward', anchor: 'below' })
    expect(assertTrustedSender).toHaveBeenCalledTimes(5)
    expect(showHistoryMenu.mock.calls).toEqual([
      ['tab-1', 'back', { x: 12, y: 72 }],
      ['tab-1', 'forward', undefined],
      ['tab-1', 'forward', undefined],
      ['tab-1', 'forward', undefined],
      ['tab-1', 'forward', undefined]
    ])
  })

  it('refuses a request without a tab or a direction', () => {
    const { show, showHistoryMenu } = handler()
    expect(() => show({ direction: 'back' })).toThrow(TypeError)
    expect(() => show({ tabId: 'tab-1', direction: 'up' })).toThrow(TypeError)
    expect(() => show(null)).toThrow(TypeError)
    expect(showHistoryMenu).not.toHaveBeenCalled()
  })
})
