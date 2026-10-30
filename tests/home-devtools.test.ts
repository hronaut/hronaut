import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron'

const built = vi.hoisted(() => ({ templates: [] as MenuItemConstructorOptions[][] }))

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      built.templates.push(template)
      return { popup: () => undefined }
    }
  }
}))

// The page menu's browser below stubs openDevTools, which Inspect reaches through this; the Developer Tools cases, whose
// browser has no such stub of its own, run the real one, even if a Browser method of that name comes back.
vi.mock('../src/main/browser/devtools/devtools.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/main/browser/devtools/devtools.js')>()
  return {
    ...original,
    openDevTools: (browser: { openDevTools?: (tab: unknown) => Promise<void> }, tab: never) => (
      Object.hasOwn(browser, 'openDevTools') ? browser.openDevTools!(tab) : original.openDevTools(browser as never, tab)
    )
  }
})

const { showContextMenu } = await import('../src/main/browser/context-menus/page-context-menu.js')
const { openDevTools, toggleDevTools } = await import('../src/main/browser/devtools/devtools.js')
type MenuBrowser = Parameters<typeof showContextMenu>[0]

interface PageTab {
  id: string
  url: string
  webContents: WebContents
}

const HOME_URL = 'hronaut://home/'

function pageWebContents(): WebContents & { inspectElement: ReturnType<typeof vi.fn>, openDevTools: ReturnType<typeof vi.fn> } {
  let opened = false
  return {
    id: 7,
    isDestroyed: () => false,
    isDevToolsOpened: () => opened,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    debugger: { isAttached: () => false, detach: () => undefined },
    once: () => undefined,
    removeListener: () => undefined,
    inspectElement: vi.fn(),
    // Opening reports open at once, so a regression fails its assertion instead of waiting for devtools-opened.
    openDevTools: vi.fn(() => { opened = true })
  } as unknown as WebContents & { inspectElement: ReturnType<typeof vi.fn>, openDevTools: ReturnType<typeof vi.fn> }
}

function devToolsTab(url: string, webContents = pageWebContents()) {
  return { id: 'tab', title: 'Page', url, webContents, networkDebuggerEpoch: 0, networkConditionApplication: 'confirmed', networkRoutes: [] }
}

/** A browser showing the tab, whose wait for the page's dialog monitoring runs dialogMonitorAttach. */
function devToolsBrowser(tab: ReturnType<typeof devToolsTab>, dialogMonitorAttach: () => unknown = () => undefined): Parameters<typeof openDevTools>[0] {
  return {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    wakeTab: async () => undefined,
    destroyed: false,
    isHumanInteractionLocked: () => false,
    devToolsOpening: new Set<number>(),
    dialogMonitorAttachPromises: { get: dialogMonitorAttach },
    debuggerQueue: { pending: () => undefined },
    text: (key: string) => key
  } as unknown as Parameters<typeof openDevTools>[0]
}

function menuFor(url: string, onOpenDevTools: (tab: PageTab) => void = () => undefined): { ids: Array<string | undefined>, tab: PageTab, openDevToolsCalls: PageTab[] } {
  const tab: PageTab = { id: 'tab', url, webContents: pageWebContents() }
  const openDevToolsCalls: PageTab[] = []
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    window: {},
    options: { copyText: async () => undefined, copyImageAt: async () => undefined },
    text: (key: string) => key,
    isHumanInteractionLocked: () => false,
    openDevTools: async (target: PageTab) => {
      openDevToolsCalls.push(target)
      onOpenDevTools(target)
    }
  } as unknown as MenuBrowser
  showContextMenu(browser, tab as never, { x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {} } as unknown as ContextMenuParams)
  return { ids: built.templates.at(-1)!.map(item => item.id), tab, openDevToolsCalls }
}

afterEach(() => {
  built.templates.length = 0
})

describe('Developer Tools on Hronaut Home', () => {
  it('leaves Inspect out of the page menu on Home and keeps it on a website', () => {
    // Inspect opened Developer Tools on Home's privileged page, which F12 and Ctrl+Shift+I refuse.
    expect(menuFor(HOME_URL).ids).not.toContain('inspect-element')
    expect(menuFor(HOME_URL).ids).toEqual(expect.arrayContaining(['back', 'forward', 'reload', 'copy-page-address']))
    expect(menuFor('https://shop.example/').ids).toContain('inspect-element')
  })

  it('inspects an element on a website from the page menu', async () => {
    const { tab, openDevToolsCalls } = menuFor('https://shop.example/')
    const inspect = built.templates.at(-1)!.find(item => item.id === 'inspect-element')!
    ;(inspect.click as () => void)()
    await vi.waitFor(() => expect(tab.webContents.inspectElement).toHaveBeenCalledWith(10, 20))
    expect(openDevToolsCalls).toEqual([tab])
  })

  it('does not open Developer Tools for Home, whichever action asks', async () => {
    const tab = devToolsTab(HOME_URL)
    await openDevTools(devToolsBrowser(tab), tab as never)
    await expect(toggleDevTools(devToolsBrowser(tab))).resolves.toBe(false)
    expect(tab.webContents.openDevTools).not.toHaveBeenCalled()
    const website = devToolsTab('https://shop.example/')
    await openDevTools(devToolsBrowser(website), website as never)
    expect(website.webContents.openDevTools).toHaveBeenCalledOnce()
  })

  it('does not open Developer Tools for a tab that shows Home once the wait ends', async () => {
    const tab = devToolsTab('https://shop.example/')
    await openDevTools(devToolsBrowser(tab, () => { tab.url = HOME_URL }), tab as never)
    expect(tab.webContents.openDevTools).not.toHaveBeenCalled()
  })

  it('does not inspect a tab that shows Home by the time Inspect is chosen or Developer Tools open', async () => {
    const chosen = menuFor('https://shop.example/')
    chosen.tab.url = HOME_URL
    ;(built.templates.at(-1)!.find(item => item.id === 'inspect-element')!.click as () => void)()
    // Inspecting opens Developer Tools by itself, even where opening them was refused.
    const opened = menuFor('https://shop.example/', tab => { tab.url = HOME_URL })
    ;(built.templates.at(-1)!.find(item => item.id === 'inspect-element')!.click as () => void)()
    await vi.waitFor(() => expect(opened.openDevToolsCalls).toEqual([opened.tab]))
    await Promise.resolve()
    expect(chosen.openDevToolsCalls).toEqual([])
    expect(chosen.tab.webContents.inspectElement).not.toHaveBeenCalled()
    expect(opened.tab.webContents.inspectElement).not.toHaveBeenCalled()
  })
})
