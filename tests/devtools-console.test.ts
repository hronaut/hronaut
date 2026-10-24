import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

vi.mock('electron', () => ({}))

const { showDevToolsConsole } = await import('../src/main/browser/devtools/devtools.js')
type DevToolsAccess = import('../src/main/browser/devtools/devtools-access.js').DevToolsAccess<import('../src/main/browser/devtools/devtools-access.js').DevToolsTab>

// Ctrl+Shift+J went to the website, where Chrome opens Developer Tools on its Console.

function page(options: { open?: boolean } = {}) {
  let opened = options.open === true
  const devTools = { isDestroyed: () => false, executeJavaScript: vi.fn(async () => undefined), focus: vi.fn() }
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    isDevToolsOpened: () => opened,
    get devToolsWebContents() { return opened ? devTools : null },
    debugger: { isAttached: () => false, detach: () => undefined },
    once: () => undefined,
    removeListener: () => undefined,
    // Opening reports open at once, so a regression fails its assertion instead of waiting for devtools-opened.
    openDevTools: vi.fn(() => { opened = true })
  }
  return { webContents: webContents as unknown as WebContents & { openDevTools: ReturnType<typeof vi.fn> }, devTools }
}

function access(url: string, webContents: WebContents, locked = false): DevToolsAccess {
  const tab = { id: 'tab', title: 'Page', url, webContents, networkDebuggerEpoch: 0, networkConditionApplication: 'confirmed', networkRoutes: [] }
  return {
    getTab: () => tab,
    findTab: () => tab,
    wakeTab: async () => undefined,
    isDestroyed: () => false,
    isHumanInteractionLocked: () => locked,
    requireNetworkConditionsKnown: () => undefined,
    devToolsOpening: () => new Set<number>(),
    dialogMonitorAttach: () => undefined,
    pendingDebuggerCommand: () => undefined,
    text: (key: string) => key
  } as unknown as DevToolsAccess
}

describe('Developer Tools on the Console', () => {
  it('opens them for a website and turns them to the Console, with the keyboard there', async () => {
    const { webContents, devTools } = page()
    await expect(showDevToolsConsole(access('https://shop.example/', webContents))).resolves.toBe(true)
    expect(webContents.openDevTools).toHaveBeenCalledOnce()
    expect(devTools.executeJavaScript).toHaveBeenCalledWith("DevToolsAPI.showPanel('console')")
    expect(devTools.focus).toHaveBeenCalledOnce()
  })

  it('turns open ones to the Console rather than closing them, as the toggle does', async () => {
    const { webContents, devTools } = page({ open: true })
    await expect(showDevToolsConsole(access('https://shop.example/', webContents))).resolves.toBe(true)
    expect(webContents.openDevTools).not.toHaveBeenCalled()
    expect(devTools.executeJavaScript).toHaveBeenCalledWith("DevToolsAPI.showPanel('console')")
  })

  it('opens none for Home or a tab whose page input is locked', async () => {
    const home = page()
    await expect(showDevToolsConsole(access('hronaut://home/', home.webContents))).resolves.toBe(false)
    const locked = page()
    await expect(showDevToolsConsole(access('https://shop.example/', locked.webContents, true))).resolves.toBe(false)
    expect(home.webContents.openDevTools).not.toHaveBeenCalled()
    expect(locked.webContents.openDevTools).not.toHaveBeenCalled()
  })
})
