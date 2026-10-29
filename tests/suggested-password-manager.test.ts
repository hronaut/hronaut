import { describe, expect, it, vi } from 'vitest'

// The tab manager binds the page menu's Suggest Strong Password to the active tab's page when the menu opens, and fills
// only while passwords can be saved and that page is still shown.

vi.mock('electron', () => ({
  session: {}, webContents: { getFocusedWebContents: () => null }, WebContentsView: class {}, nativeImage: {}, shell: {},
  app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined }, Menu: {}
}))

vi.mock('../src/main/browser/agent-input-scope/agent-input-scope.js', async (original) => ({
  ...await original<typeof import('../src/main/browser/agent-input-scope/agent-input-scope.js')>(),
  withAgentInput: vi.fn(async (_access: unknown, _webContents: unknown, operation: () => Promise<unknown>) => operation())
}))

const { Browser } = await import('../src/main/browser/browser.js')

interface Tab {
  id: string
  url: string
  navigationGeneration: number
  humanInteractionGeneration: number
  lastHumanInteractionAt: number
  lastActiveAt: number
  webContents: { isDestroyed(): boolean, executeJavaScriptInIsolatedWorld: ReturnType<typeof vi.fn> }
}
interface Manager {
  tabs: Map<string, Tab>
  activeTabId: string | null
  tabSelectionGeneration: number
  options: Record<string, unknown>
  pageContextMenuAccess(): { passwordSuggestion(tab: Tab): (() => Promise<boolean>) | null }
}

function browser(available = true) {
  const executeJavaScript = vi.fn(async (_worldId: number, scripts: Array<{ code: string }>, _userGesture?: boolean) =>
    scripts[0]!.code.includes('return { minLength: field.minLength') ? { minLength: -1, maxLength: -1 } : 'filled')
  const page: Tab = {
    id: 'page',
    url: 'https://accounts.example/sign-up',
    navigationGeneration: 2,
    humanInteractionGeneration: 0,
    lastHumanInteractionAt: 0,
    lastActiveAt: 0,
    webContents: { isDestroyed: () => false, executeJavaScriptInIsolatedWorld: executeJavaScript }
  }
  const suggested = vi.fn()
  const whileAgentsPaused = vi.fn(async (fill: () => Promise<boolean>) => fill())
  const manager = Object.assign(Object.create(Browser.prototype), {
    tabs: new Map([['page', page], ['other', { ...page, id: 'other', url: 'https://other.example/' }]]),
    activeTabId: 'page',
    tabSelectionGeneration: 5,
    options: { suggestedPasswords: { available: () => available, whileAgentsPaused, suggested } }
  }) as Manager
  return { manager, page, executeJavaScript, suggested, whileAgentsPaused, suggestion: () => manager.pageContextMenuAccess().passwordSuggestion(page) }
}

describe('Suggest Strong Password in the tab manager', () => {
  it('fills the active tab’s page while agents pause and remembers the password for its website', async () => {
    const { page, executeJavaScript, suggested, whileAgentsPaused, suggestion } = browser()
    await expect(suggestion()!()).resolves.toBe(true)
    expect(whileAgentsPaused).toHaveBeenCalledOnce()
    expect(suggested).toHaveBeenCalledExactlyOnceWith('https://accounts.example', expect.stringMatching(/^[a-km-np-zA-HJ-NP-Z2-9]{15}$/u))
    const fill = executeJavaScript.mock.calls.at(-1)!
    expect(fill[1][0]!.code).toContain(JSON.stringify(suggested.mock.calls[0]![1]))
    expect(fill[1][0]!.code).toContain(JSON.stringify('https://accounts.example/sign-up'))
    expect(fill[2]).toBe(true)
    expect(page.humanInteractionGeneration).toBe(1)
  })

  it('offers nothing while passwords cannot be saved, in a tab behind another, or on a page that is no website', () => {
    expect(browser(false).suggestion()).toBeNull()

    const behind = browser()
    behind.manager.activeTabId = 'other'
    expect(behind.suggestion()).toBeNull()

    const home = browser()
    home.page.url = 'hronaut://home/'
    expect(home.suggestion()).toBeNull()

    const closed = browser()
    closed.manager.tabs.delete('page')
    expect(closed.suggestion()).toBeNull()
  })

  it('fills nothing once the page navigated, another tab was selected, or the tab closed after the menu opened', async () => {
    for (const change of [
      (manager: Manager, page: Tab) => { page.navigationGeneration++ },
      (manager: Manager) => { manager.tabSelectionGeneration++ },
      (manager: Manager) => { manager.activeTabId = 'other' },
      (manager: Manager) => { manager.tabs.delete('page') }
    ]) {
      const { manager, page, executeJavaScript, suggested, suggestion } = browser()
      const suggest = suggestion()!
      change(manager, page)
      await expect(suggest()).resolves.toBe(false)
      expect(executeJavaScript).not.toHaveBeenCalled()
      expect(suggested).not.toHaveBeenCalled()
    }
  })
})
