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

const { showContextMenu } = await import('../src/main/browser/context-menus/page-context-menu.js')
const { openDevTools } = await import('../src/main/browser/devtools/devtools.js')
type PageContextMenuAccess = import('../src/main/browser/context-menus/page-context-menu-access.js').PageContextMenuAccess<PageTab>
type DevToolsAccess = import('../src/main/browser/devtools/devtools-access.js').DevToolsAccess<import('../src/main/browser/devtools/devtools-access.js').DevToolsTab>

interface PageTab {
  id: string
  url: string
  webContents: WebContents
}

const HOME_URL = 'hronaut://home/'

function pageWebContents(): WebContents & { inspectElement: ReturnType<typeof vi.fn>, openDevTools: ReturnType<typeof vi.fn> } {
  return {
    id: 7,
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    debugger: { isAttached: () => false, detach: () => undefined },
    once: () => undefined,
    removeListener: () => undefined,
    inspectElement: vi.fn(),
    openDevTools: vi.fn()
  } as unknown as WebContents & { inspectElement: ReturnType<typeof vi.fn>, openDevTools: ReturnType<typeof vi.fn> }
}

function menuFor(url: string): { ids: Array<string | undefined>, tab: PageTab, openDevToolsCalls: PageTab[] } {
  const tab: PageTab = { id: 'tab', url, webContents: pageWebContents() }
  const openDevToolsCalls: PageTab[] = []
  const access = {
    findTab: () => tab,
    window: () => ({}),
    options: () => ({ copyText: async () => undefined, copyImageAt: async () => undefined }),
    text: (key: string) => key,
    isHumanInteractionLocked: () => false,
    openDevTools: async (target: PageTab) => {
      openDevToolsCalls.push(target)
    }
  } as unknown as PageContextMenuAccess
  showContextMenu(access, tab, { x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {} } as unknown as ContextMenuParams)
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
    const webContents = pageWebContents()
    const tab = { id: 'home', title: 'Home', url: HOME_URL, webContents, networkDebuggerEpoch: 0, networkConditionApplication: 'confirmed', networkRoutes: [] }
    const access = {
      findTab: () => tab,
      isDestroyed: () => false,
      requireNetworkConditionsKnown: () => undefined,
      devToolsOpening: () => new Set<number>(),
      dialogMonitorAttach: () => undefined,
      pendingDebuggerCommand: () => undefined,
      text: (key: string) => key
    } as unknown as DevToolsAccess
    await openDevTools(access, tab as never)
    expect(webContents.openDevTools).not.toHaveBeenCalled()
  })
})
