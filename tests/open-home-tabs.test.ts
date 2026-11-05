import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { HOME_IPC } from '../src/shared/ipc/home.js'

// The browser's state and the keyboard's move are the browser's own; these reach the fake browser below.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  browserState: () => ({})
}))
vi.mock('../src/main/browser/trusted-chrome-focus/trusted-chrome-focus.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/trusted-chrome-focus/trusted-chrome-focus.js')>(),
  focusTabOrTrustedChrome: vi.fn()
}))

const { openHomeTabs } = await import('../src/main/browser/home-tabs/home-tabs.js')

/** A browser with no Home, whose new Home is still loading. */
function loadingHome() {
  const contents = Object.assign(new EventEmitter(), {
    send: vi.fn(), isDestroyed: () => false, isLoadingMainFrame: () => true, getURL: () => ''
  })
  const tabs = new Map<string, { id: string, url: string, webContents: typeof contents }>()
  const browser = {
    tabs,
    activeTabId: null as string | null,
    window: { isFocused: () => false },
    selectTab: vi.fn(),
    createTab: vi.fn(async ({ url }: { url: string }) => {
      tabs.set('home', { id: 'home', url, webContents: contents })
      browser.activeTabId = 'home'
    })
  }
  const shows = () => contents.send.mock.calls.filter(([channel]) => channel === HOME_IPC.showTabs).length
  const waiting = () => contents.listenerCount('did-finish-load') + contents.listenerCount('did-fail-load')
  return { browser, contents, shows, waiting }
}

describe('opening Home on its Tabs view', () => {
  it('tells a new Home to show its Tabs view once it has loaded, and only that once', async () => {
    const { browser, contents, shows, waiting } = loadingHome()
    await openHomeTabs(browser as never)
    expect(shows()).toBe(0)
    contents.emit('did-finish-load')
    expect(shows()).toBe(1)
    expect(waiting()).toBe(0)
    // A later load of Home, such as after a language change, keeps the view the person chose.
    contents.emit('did-finish-load')
    expect(shows()).toBe(1)
  })

  it('leaves nothing waiting once the load of Home fails', async () => {
    const { browser, contents, shows, waiting } = loadingHome()
    await openHomeTabs(browser as never)
    // A frame inside the page failing leaves Home's own load under way.
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://frame.example/', false)
    expect(waiting()).toBe(2)
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'hronaut://home/', true)
    expect(waiting()).toBe(0)
    contents.emit('did-finish-load')
    expect(shows()).toBe(0)
  })
})
