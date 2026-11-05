import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { registerHomeIpc } from '../src/main/home/home-ipc.js'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings-store.js'
import { HOME_IPC } from '../src/shared/ipc/home.js'

const calls = vi.hoisted(() => ({
  previews: [] as string[][],
  pagePreviews: [] as string[],
  actions: [] as unknown[]
}))
vi.mock('../src/main/browser/tab-overview-previews/tab-overview-previews.js', () => ({
  getTabOverviewPreviews: (_browser: unknown, tabIds: string[]) => { calls.previews.push(tabIds); return [] },
  getTabOverviewPagePreview: async (_browser: unknown, tabId: string) => { calls.pagePreviews.push(tabId); return { tabId } }
}))
vi.mock('../src/main/home/home-tabs.js', () => ({
  homeTabsState: () => ({ tabs: [] }),
  runHomeTabAction: async (_browser: unknown, action: unknown) => { calls.actions.push(action); return { tabs: [] } }
}))

/** Home's IPC over a browser with a website tab and Home's own tab; `url` is the page that asks. */
function home(url = 'hronaut://home/') {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const browser = { tabs: new Map([['page', { url: 'https://page.example.com/' }], ['home', { url: 'hronaut://home/' }]]) }
  registerHomeIpc({
    handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as never) },
    workspaceStartupFailure: () => undefined,
    tabs: () => browser as never,
    mainWindow: () => null,
    copyTextToClipboard: async () => undefined,
    reportClipboardFailure: () => undefined,
    mcpUrl: () => 'http://127.0.0.1:47812/mcp',
    settings: () => DEFAULT_SETTINGS,
    mcpTokenConfiguration: () => ({ token: 'token', source: 'profile' }),
    mcpCredentialAccepted: () => false,
    openExternal: async () => undefined,
    mcpPortRecovery: () => ({ move: vi.fn() }),
    showDialog: vi.fn(async () => ({ response: 0 })),
    focusAskingPage: vi.fn(),
    text: key => key
  })
  const mainFrame = { url }
  const sender = Object.assign(new EventEmitter(), { id: 1, mainFrame })
  const event = { sender, senderFrame: mainFrame }
  return (channel: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(channel)!(event, ...args))
}

describe("Home's Tabs view IPC", () => {
  it('answers only Home: a website cannot read the tabs, their pictures or act on them', async () => {
    const invoke = home('https://evil.example/')
    for (const [channel, ...args] of [[HOME_IPC.tabs], [HOME_IPC.tabPreviews, ['page']], [HOME_IPC.tabPagePreview, 'page'], [HOME_IPC.tabAction, { kind: 'back' }]] as const) {
      await expect(invoke(channel, ...args)).rejects.toThrow()
    }
    expect(calls.previews).toEqual([])
    expect(calls.pagePreviews).toEqual([])
    expect(calls.actions).toEqual([])
  })

  it("never pictures Home's own tab, and checks the ids it is given", async () => {
    const invoke = home()
    await invoke(HOME_IPC.tabPreviews, ['page', 'home', 'unknown'])
    expect(calls.previews.at(-1)).toEqual(['page', 'unknown'])
    await expect(invoke(HOME_IPC.tabPreviews, 'page')).rejects.toThrow(TypeError)
    await expect(invoke(HOME_IPC.tabPreviews, ['page', 'page'])).rejects.toThrow(TypeError)
    await expect(invoke(HOME_IPC.tabPagePreview, 'home')).rejects.toThrow(TypeError)
    await expect(invoke(HOME_IPC.tabPagePreview, 7)).rejects.toThrow(TypeError)
    // An empty, padded or overlong ID never falls back to another tab, such as the one shown.
    for (const invalid of ['', ' page', 'x'.repeat(129)]) await expect(invoke(HOME_IPC.tabPagePreview, invalid)).rejects.toThrow(TypeError)
    await invoke(HOME_IPC.tabPagePreview, 'page')
    expect(calls.pagePreviews).toEqual(['page'])
    await invoke(HOME_IPC.tabAction, { kind: 'open', tabId: 'page' })
    expect(calls.actions).toEqual([{ kind: 'open', tabId: 'page' }])
  })
})
