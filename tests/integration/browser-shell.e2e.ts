import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { BROWSER_TOOL_CATALOG } from '../../src/main/mcp/server.js'
import type { BrowserEnvironmentSettings, BrowserState, BrowserStorageResult, BrowserViewportEmulation, HronautApi, RendererSettingsState } from '../../src/shared/types.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

const execFileAsync = promisify(execFile)
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function closeFixtureServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    // Chromium can keep an otherwise idle page connection alive after every
    // assertion has completed. Stop accepting first, then close those test-only
    // sockets so teardown cannot consume the test's global timeout.
    server.closeAllConnections()
  })
}

function mcpResultText(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

test('launches a visible browser shell with a loopback MCP endpoint', async ({
  appWindow,
  electronApp,
  mcpPort
}) => {
  await expect(appWindow).toHaveTitle('Hronaut')
  await expect(appWindow.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect(appWindow.getByRole('button', { name: /MCP ready/ })).toBeVisible()
  await expect.poll(() => appWindow.evaluate('window.hronautMcp.getState()')).toMatchObject({ status: 'ready', paused: false })
  const pauseAgents = appWindow.getByRole('button', { name: 'Pause agents' })
  await pauseAgents.click()
  await expect(appWindow.getByRole('button', { name: 'Resume agents' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => appWindow.evaluate('window.hronautMcp.getState()')).toMatchObject({ status: 'paused', paused: true })
  await appWindow.getByRole('button', { name: 'Resume agents' }).click()
  await expect(appWindow.getByRole('button', { name: 'Pause agents' })).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => appWindow.evaluate('window.hronautMcp.getState()')).toMatchObject({ status: 'ready', paused: false })

  const windowState = await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return { visible: window?.isVisible(), destroyed: window?.isDestroyed() }
  })
  expect(windowState).toEqual({ visible: true, destroyed: false })

  await expect
    .poll(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${mcpPort}/healthz`)
        const body = (await response.json()) as { name?: string }
        return response.ok && body.name === 'hronaut'
      } catch {
        return false
      }
    })
    .toBe(true)
})

test('traps keyboard focus inside Settings at minimum scaled window', async ({
  appWindow,
  electronApp
}) => {
  const settingsButton = appWindow.getByRole('button', { name: 'Settings' })
  await settingsButton.click()
  const settings = appWindow.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('combobox', { name: 'Interface size' }).selectOption('1.25')
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(760, 520))

  await settingsButton.click()
  await expect(settings).toBeVisible()
  await expect.poll(() => appWindow.evaluate(() => (
    document.querySelector('[role="dialog"][aria-label="Settings"], [role="dialog"][aria-labelledby="settings-title"]')
      ?.contains(document.activeElement) ?? false
  ))).toBe(true)

  await appWindow.keyboard.press('Shift+Tab')
  await expect.poll(() => appWindow.evaluate(() => (
    document.querySelector('[role="dialog"][aria-label="Settings"], [role="dialog"][aria-labelledby="settings-title"]')
      ?.contains(document.activeElement) ?? false
  ))).toBe(true)
  for (let index = 0; index < 24; index += 1) {
    await appWindow.keyboard.press('Tab')
    expect(await settings.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true)
  }

  await appWindow.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(settingsButton).toBeFocused()
})

test("keeps the compact What's new reader usable at desktop and minimum window sizes", async ({
  appWindow,
  electronApp
}, testInfo) => {
  const fixtureUrl = 'data:text/html,<title>Release history website fixture</title><main>Release history website fixture</main>'
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(fixtureUrl)}, active: true })`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'))
    .toBe('Release history website fixture')
  const websiteBounds = async () => electronApp.evaluate(({ BrowserWindow, WebContentsView }, requestedUrl) => {
    const main = BrowserWindow.getAllWindows()[0]
    const view = main?.contentView.children.find((candidate) => (
      candidate instanceof WebContentsView && candidate.webContents.getURL() === requestedUrl
    ))
    return view?.getBounds()
  }, fixtureUrl)
  await expect.poll(async () => (await websiteBounds())?.height ?? 0).toBeGreaterThan(1)

  const settingsButton = appWindow.getByRole('button', { name: 'Settings' })
  await settingsButton.click()
  const settings = appWindow.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('button', { name: /Updates Automatic checks/ }).click()
  await settings.getByRole('button', { name: "View what's new" }).click()

  const releaseHistory = appWindow.getByRole('dialog', { name: "What's new" })
  await expect(settings).toBeHidden()
  await expect(releaseHistory).toBeVisible()
  await expect.poll(async () => (await websiteBounds())?.height).toBe(1)
  await expect(releaseHistory).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 })
  const desktopBounds = await releaseHistory.boundingBox()
  expect(desktopBounds).not.toBeNull()
  expect(desktopBounds!.width).toBeLessThanOrEqual(560)
  expect(desktopBounds!.height).toBeLessThanOrEqual(720)
  await appWindow.screenshot({ path: testInfo.outputPath('whats-new-desktop.png') })

  await appWindow.keyboard.press(`${primaryModifier}+Shift+P`)
  await expect(releaseHistory).toBeVisible()
  await expect(appWindow.getByRole('dialog', { name: 'Commands' })).toBeHidden()

  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(760, 520))
  const minimumBounds = await releaseHistory.boundingBox()
  expect(minimumBounds).not.toBeNull()
  expect(minimumBounds!.x).toBeGreaterThanOrEqual(0)
  expect(minimumBounds!.y).toBeGreaterThanOrEqual(0)
  expect(minimumBounds!.x + minimumBounds!.width).toBeLessThanOrEqual(760)
  expect(minimumBounds!.y + minimumBounds!.height).toBeLessThanOrEqual(520)
  await expect(releaseHistory.getByRole('button', { name: "Close What's new" })).toBeVisible()
  await appWindow.screenshot({ path: testInfo.outputPath('whats-new-minimum.png') })

  await appWindow.keyboard.press('Escape')
  await expect(releaseHistory).toBeHidden()
  await expect(settingsButton).toBeFocused()
  await expect.poll(async () => (await websiteBounds())?.height ?? 0).toBeGreaterThan(1)
})

test('opens a scheme-less loopback address over HTTP from the address bar', async ({ appWindow }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end('<!doctype html><title>Scheme-less loopback</title><main>Local development server</main>')
  })
  const address = await new Promise<{ port: number }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address() as { port: number }))
  })

  try {
    await appWindow.getByRole('button', { name: 'New tab' }).click()
    const addressInput = appWindow.getByRole('combobox', { name: 'Address' })
    await addressInput.fill(`127.0.0.1:${address.port}/scheme-less`)
    await addressInput.press('Enter')

    await expect.poll(() => appWindow.evaluate(
      'window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.url)'
    )).toBe(`http://127.0.0.1:${address.port}/scheme-less`)
    await expect.poll(() => appWindow.evaluate(
      'window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'
    )).toBe('Scheme-less loopback')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('locks Site Storage controls while a destructive mutation is pending', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end('<!doctype html><title>Storage mutation lock</title><main>Storage fixture</main>')
  })
  const address = await new Promise<{ port: number }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address() as { port: number }))
  })

  try {
    const state = await appWindow.evaluate(async (url) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.newTab({ url, active: true }), `http://127.0.0.1:${address.port}/`)
    const tabId = state.activeTabId
    if (!tabId) throw new Error('Storage fixture tab did not become active')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'))
      .toBe('Storage mutation lock')
    await appWindow.evaluate(async (currentTabId) => {
      const browser = (window as unknown as { hronaut: HronautApi }).hronaut
      await browser.manageStorage({
        tabId: currentTabId,
        kind: 'local-storage',
        action: 'set',
        key: 'first',
        value: '1',
        includeValues: true
      })
      return browser.manageStorage({
        tabId: currentTabId,
        kind: 'local-storage',
        action: 'set',
        key: 'second',
        value: '2',
        includeValues: true
      })
    }, tabId)

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    const pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
    await pageTools.getByRole('button', { name: 'Site storage for 127.0.0.1' }).click()
    const storagePanel = appWindow.getByRole('dialog', { name: /Site storage/ })
    await expect(storagePanel.getByRole('button', { name: 'Delete first' })).toBeVisible()
    await expect(storagePanel.getByRole('button', { name: 'Delete second' })).toBeVisible()
    const initialResult = await appWindow.evaluate((currentTabId) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.manageStorage({
      tabId: currentTabId,
      kind: 'local-storage',
      action: 'list',
      includeValues: true
    }), tabId)

    await electronApp.evaluate(({ ipcMain }, result) => {
      const control = {
        requests: [] as Array<{ resolve: (value: BrowserStorageResult) => void }>,
        result: result as BrowserStorageResult
      }
      ;(globalThis as typeof globalThis & { __pendingStorageMutation?: typeof control }).__pendingStorageMutation = control
      ipcMain.removeHandler('browser:manage-storage')
      ipcMain.handle('browser:manage-storage', (_event, value: unknown) => {
        if ((value as { action?: unknown })?.action !== 'delete') throw new Error('Unexpected storage operation')
        return new Promise<BrowserStorageResult>((resolve) => control.requests.push({ resolve }))
      })
    }, initialResult)

    await storagePanel.getByRole('button', { name: 'Delete first' }).click()
    await expect.poll(() => electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __pendingStorageMutation?: { requests: unknown[] } }
    ).__pendingStorageMutation?.requests.length)).toBe(1)

    await expect(storagePanel.getByRole('button', { name: 'Delete second' })).toBeDisabled()
    await expect(storagePanel.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled()
    await expect(storagePanel.getByRole('button', { name: 'Session', exact: true })).toBeDisabled()
    await expect(storagePanel.getByRole('textbox', { name: 'Storage key' })).toBeDisabled()
    await expect(storagePanel.getByRole('textbox', { name: 'Storage value' })).toBeDisabled()

    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __pendingStorageMutation?: {
          requests: Array<{ resolve: (value: BrowserStorageResult) => void }>
          result: BrowserStorageResult
        }
      }).__pendingStorageMutation
      const request = control?.requests[0]
      if (!control || !request) throw new Error('Storage mutation was not captured')
      request.resolve({
        ...control.result,
        action: 'delete',
        changed: true,
        itemCount: 1,
        items: control.result.items.filter((item) => item.key !== 'first')
      })
    })

    await expect(storagePanel.getByRole('button', { name: 'Delete first' })).toHaveCount(0)
    await expect(storagePanel.getByRole('button', { name: 'Delete second' })).toBeEnabled()
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('recovers from an initial renderer settings failure before Vue mounts', async ({ appWindow, electronApp }) => {
  const settingsState = await appWindow.evaluate('window.hronautSettings.getRendererState()') as RendererSettingsState
  await appWindow.addInitScript(() => {
    ;(globalThis as typeof globalThis & { __hronautInitialSettingsFailureReload?: boolean })
      .__hronautInitialSettingsFailureReload = true
  })
  await electronApp.evaluate(({ ipcMain }, state) => {
    let markedCalls = 0
    ipcMain.removeHandler('settings:get-renderer-state')
    ipcMain.handle('settings:get-renderer-state', async (event) => {
      const marked = await event.sender.executeJavaScript('Boolean(globalThis.__hronautInitialSettingsFailureReload)')
      if (!marked) return state
      markedCalls += 1
      if (markedCalls === 1) throw new Error('Initial renderer settings unavailable for regression test')
      return state
    })
  }, settingsState)

  await appWindow.reload()

  const failure = appWindow.getByRole('alert', { name: 'Hronaut could not start' })
  await expect(failure).toContainText('Initial renderer settings unavailable for regression test')
  const retry = appWindow.getByRole('button', { name: 'Try again' })
  await expect(retry).toBeFocused()
  await retry.click()
  await expect(appWindow.getByRole('button', { name: 'Settings' })).toBeEnabled()
})

test('retries only the transiently failed startup service and reports recovery', async ({ appWindow, electronApp }) => {
  const settingsState = await appWindow.evaluate('window.hronautSettings.getRendererState()') as RendererSettingsState
  await appWindow.addInitScript(() => {
    type RejectionEvent = { reason: unknown; preventDefault: () => void }
    const shellWindow = globalThis as typeof globalThis & {
      __hronautUnhandledBootstrapRejection?: string | null
      __hronautUnhandledBootstrapRejectionListener?: (event: RejectionEvent) => void
      addEventListener: (type: string, listener: (event: RejectionEvent) => void) => void
    }
    ;(shellWindow as typeof shellWindow & { __hronautLiveSettingsFailureReload?: boolean })
      .__hronautLiveSettingsFailureReload = true
    shellWindow.__hronautUnhandledBootstrapRejection = null
    shellWindow.__hronautUnhandledBootstrapRejectionListener = (event) => {
      shellWindow.__hronautUnhandledBootstrapRejection = event.reason instanceof Error
        ? event.reason.message
        : String(event.reason)
      event.preventDefault()
    }
    shellWindow.addEventListener('unhandledrejection', shellWindow.__hronautUnhandledBootstrapRejectionListener)
  })
  await electronApp.evaluate(({ ipcMain }, state) => {
    const mainGlobal = globalThis as typeof globalThis & { __hronautStartupDownloadsListCount?: number }
    mainGlobal.__hronautStartupDownloadsListCount = 0
    ipcMain.removeHandler('settings:get-renderer-state')
    ipcMain.handle('settings:get-renderer-state', async (event) => {
      const marked = await event.sender.executeJavaScript('Boolean(globalThis.__hronautLiveSettingsFailureReload)')
      if (!marked) return state
      const calls = (mainGlobal as typeof mainGlobal & { __hronautStartupSettingsCalls?: number })
      calls.__hronautStartupSettingsCalls = (calls.__hronautStartupSettingsCalls ?? 0) + 1
      if (calls.__hronautStartupSettingsCalls === 2) {
        throw new Error('Live renderer settings unavailable for regression test')
      }
      return state
    })
    ipcMain.removeHandler('downloads:list')
    ipcMain.handle('downloads:list', () => {
      mainGlobal.__hronautStartupDownloadsListCount = (mainGlobal.__hronautStartupDownloadsListCount ?? 0) + 1
      return []
    })
  }, settingsState)

  await appWindow.reload()

  const failure = appWindow.getByRole('alert', { name: 'Startup incomplete' })
  await expect(failure).toContainText('Live renderer settings unavailable for regression test')
  await expect(appWindow.getByRole('status', { name: 'Startup recovered' })).toContainText(
    'All Hronaut services are available again.'
  )
  await expect.poll(() => electronApp.evaluate(() => (
    globalThis as typeof globalThis & { __hronautStartupDownloadsListCount?: number }
  ).__hronautStartupDownloadsListCount)).toBe(1)
  expect(await appWindow.evaluate(() => {
    type RejectionEvent = { reason: unknown; preventDefault: () => void }
    const shellWindow = globalThis as typeof globalThis & {
      __hronautUnhandledBootstrapRejection?: string | null
      __hronautUnhandledBootstrapRejectionListener?: (event: RejectionEvent) => void
      removeEventListener: (type: string, listener: (event: RejectionEvent) => void) => void
    }
    const rejection = shellWindow.__hronautUnhandledBootstrapRejection
    if (shellWindow.__hronautUnhandledBootstrapRejectionListener) {
      shellWindow.removeEventListener('unhandledrejection', shellWindow.__hronautUnhandledBootstrapRejectionListener)
    }
    delete shellWindow.__hronautUnhandledBootstrapRejection
    delete shellWindow.__hronautUnhandledBootstrapRejectionListener
    return rejection
  })).toBeNull()
  await expect(appWindow.getByRole('button', { name: 'Settings' })).toBeEnabled()
})

test('copies shell text through the verified native clipboard bridge', async ({ appWindow, electronApp }) => {
  const expected = 'Hronaut clipboard bridge \u2713'
  await electronApp.evaluate(({ clipboard }) => clipboard.clear())

  await appWindow.evaluate(`window.hronaut.copyText(${JSON.stringify(expected)})`)

  await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(expected)
})

test('opens credential-free VS Code MCP setup through the system protocol handler', async ({
  appWindow,
  electronApp,
  mcpPort
}) => {
  await expect.poll(() => electronApp.evaluate(({ webContents }) => (
    webContents.getAllWebContents().some((contents) => contents.getURL().startsWith('hronaut://home'))
  ))).toBe(true)
  await electronApp.evaluate(({ shell }) => {
    shell.openExternal = async (url): Promise<void> => {
      ;(globalThis as typeof globalThis & { __hronautVsCodeInstallUrl?: string })
        .__hronautVsCodeInstallUrl = url
    }
  })
  const tabCount = await appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.length)')
  const action = await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return home.executeJavaScript(`(() => {
      document.querySelector('[data-guide="vscode"]')?.click();
      const button = document.querySelector('[data-vscode-install]');
      const hidden = document.getElementById('guide-primary-action')?.hidden;
      button?.click();
      return { label: button?.textContent, hidden };
    })()`)
  }) as { label: string; hidden: boolean }

  expect(action).toEqual({ label: 'Open in VS Code', hidden: false })
  await expect.poll(() => electronApp.evaluate(() => (
    globalThis as typeof globalThis & { __hronautVsCodeInstallUrl?: string }
  ).__hronautVsCodeInstallUrl)).toMatch(/^vscode:mcp\/install\?/)
  const uri = await electronApp.evaluate(() => (
    globalThis as typeof globalThis & { __hronautVsCodeInstallUrl?: string }
  ).__hronautVsCodeInstallUrl)
  if (!uri) throw new Error('VS Code MCP install URI was not captured')
  const installConfiguration = JSON.parse(decodeURIComponent(new URL(uri).search.slice(1))) as Record<string, unknown>
  expect(installConfiguration).toEqual({
    name: 'hronaut',
    type: 'http',
    url: `http://127.0.0.1:${mcpPort}/mcp`
  })
  expect(uri).not.toMatch(/authorization|bearer|token|header/i)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.length)')).toBe(tabCount)
})

test('clears stale VS Code launch errors after a successful retry', async ({ electronApp }) => {
  await expect.poll(() => electronApp.evaluate(({ webContents }) => (
    webContents.getAllWebContents().some((contents) => contents.getURL().startsWith('hronaut://home'))
  ))).toBe(true)
  await electronApp.evaluate(({ shell }) => {
    ;(globalThis as typeof globalThis & { __hronautFailVsCodeInstall?: boolean })
      .__hronautFailVsCodeInstall = true
    shell.openExternal = async (): Promise<void> => {
      if ((globalThis as typeof globalThis & { __hronautFailVsCodeInstall?: boolean })
        .__hronautFailVsCodeInstall) {
        throw new Error('VS Code protocol handler is unavailable')
      }
    }
  })
  const clickInstall = async (): Promise<void> => {
    await electronApp.evaluate(async ({ webContents }) => {
      const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
      if (!home) throw new Error('Hronaut Home web contents was not found')
      await home.executeJavaScript(`(() => {
        document.querySelector('[data-guide="vscode"]')?.click();
        document.querySelector('[data-vscode-install]')?.click();
      })()`)
    })
  }
  const feedback = async (): Promise<{ disabled: boolean; status: string; title: string }> => (
    electronApp.evaluate(async ({ webContents }) => {
      const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
      if (!home) throw new Error('Hronaut Home web contents was not found')
      return home.executeJavaScript(`(() => {
        const button = document.querySelector('[data-vscode-install]');
        return {
          disabled: Boolean(button?.disabled),
          status: document.getElementById('guide-primary-status')?.textContent || '',
          title: button?.title || ''
        };
      })()`)
    }) as Promise<{ disabled: boolean; status: string; title: string }>
  )

  await clickInstall()
  await expect.poll(feedback).toEqual({
    disabled: false,
    status: 'Could not open VS Code. Use the manual setup below.',
    title: 'Error invoking remote method \'hronaut-home:open-vscode-install\': Error: VS Code protocol handler is unavailable'
  })

  await electronApp.evaluate(() => {
    ;(globalThis as typeof globalThis & { __hronautFailVsCodeInstall?: boolean })
      .__hronautFailVsCodeInstall = false
  })
  await clickInstall()
  await expect.poll(feedback).toEqual({
    disabled: false,
    status: 'VS Code opened. Confirm the Hronaut MCP server there.',
    title: ''
  })
})

test('copies Home setup natively, reports failures in shell chrome, and withholds the bridge from websites', async ({
  appWindow,
  electronApp
}) => {
  await expect.poll(() => electronApp.evaluate(({ webContents }) =>
    webContents.getAllWebContents().some((contents) => contents.getURL().startsWith('hronaut://home'))
  )).toBe(true)
  await electronApp.evaluate(({ clipboard }) => clipboard.clear())
  await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    await home.executeJavaScript(`document.querySelector('[data-copy-target="guide-code"]').click()`)
  })

  await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain('codex mcp add hronaut')
  await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    return home?.executeJavaScript(`document.querySelector('[data-copy-target="guide-code"]').textContent`)
  })).toBe('Copied')

  await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    await home.executeJavaScript(`document.querySelector('[data-copy-target="first-run-prompt"]').click()`)
  })
  await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain('Hronaut first run')
  await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain('Do not use the Default workspace')

  await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Clipboard boundary</title>', active: true })`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'))
    .toBe('Clipboard boundary')
  const websiteBridge = await electronApp.evaluate(async ({ webContents }) => {
    const website = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Clipboard boundary')
    if (!website) throw new Error('Website web contents was not found')
    return website.executeJavaScript(`typeof window.hronautHome`)
  })
  expect(websiteBridge).toBe('undefined')

  await appWindow.getByRole('button', { name: 'Open Hronaut Home' }).click()
  await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    await home.executeJavaScript(`(() => {
      const button = document.querySelector('[data-copy-target="guide-code"]');
      const target = document.getElementById(button.dataset.copyTarget);
      target.textContent = 'x'.repeat(${8 * 1024 * 1024 + 1});
      button.click();
    })()`)
  })
  const toast = appWindow.getByRole('alert', { name: 'Copy failed' })
  await expect(toast).toBeVisible()
  await expect(toast).toContainText('maximum 8 MB')
})

test('keeps the newest Home dashboard refresh when status responses resolve out of order', async ({
  electronApp
}) => {
  await expect.poll(() => electronApp.evaluate(({ webContents }) =>
    webContents.getAllWebContents().some((contents) => contents.getURL().startsWith('hronaut://home'))
  )).toBe(true)

  const renderedVersion = await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return home.executeJavaScript(`(async () => {
      const pending = [];
      const originalFetch = window.fetch;
      window.fetch = () => new Promise((resolve) => pending.push(resolve));
      try {
        const olderRefresh = refreshDashboard();
        const newerRefresh = refreshDashboard();
        while (pending.length < 2) await Promise.resolve();
        const response = (version) => ({
          ok: true,
          json: async () => ({ ...dashboard, version })
        });
        pending[1](response('newer'));
        await newerRefresh;
        pending[0](response('older'));
        await olderRefresh;
        return document.getElementById('server-version').textContent;
      } finally {
        window.fetch = originalFetch;
      }
    })()`)
  })

  expect(renderedVersion).toBe('Hronaut newer')
})

test('does not overlap Home dashboard polling while a status response is pending', async ({
  electronApp
}) => {
  await expect.poll(() => electronApp.evaluate(({ webContents }) =>
    webContents.getAllWebContents().some((contents) => contents.getURL().startsWith('hronaut://home'))
  )).toBe(true)

  const concurrentRequests = await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return home.executeJavaScript(`(async () => {
      const pending = [];
      const originalFetch = window.fetch;
      window.fetch = () => new Promise((resolve) => pending.push(resolve));
      try {
        await new Promise((resolve) => setTimeout(resolve, 4200));
        return pending.length;
      } finally {
        const response = { ok: true, json: async () => dashboard };
        pending.splice(0).forEach((resolve) => resolve(response));
        window.fetch = originalFetch;
      }
    })()`)
  })

  expect(concurrentRequests).toBe(1)
})

test('restarts Home copy feedback after repeated setup copies', async ({ electronApp }) => {
  await expect.poll(() => electronApp.evaluate(({ webContents }) =>
    webContents.getAllWebContents().some((contents) => contents.getURL().startsWith('hronaut://home'))
  )).toBe(true)

  const feedback = await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return home.executeJavaScript(`(async () => {
      const callbacks = [];
      const originalSetTimeout = window.setTimeout;
      const originalClearTimeout = window.clearTimeout;
      window.setTimeout = (callback, delay, ...args) => {
        if (delay !== 1200) return originalSetTimeout(callback, delay, ...args);
        callbacks.push(callback);
        return 100000 + callbacks.length;
      };
      window.clearTimeout = (handle) => {
        if (Number(handle) > 100000) return;
        originalClearTimeout(handle);
      };
      const waitFor = async (condition) => {
        for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) {
          await new Promise((resolve) => originalSetTimeout(resolve, 10));
        }
        if (!condition()) throw new Error('Timed out waiting for Home copy feedback');
      };
      try {
        const button = document.querySelector('[data-copy-target="guide-code"]');
        button.click();
        await waitFor(() => callbacks.length === 1 && button.textContent === messages.copy.copied);
        button.click();
        await waitFor(() => callbacks.length === 2);
        callbacks[0]();
        const afterFirstTimeout = button.textContent;
        callbacks[1]();
        return { afterFirstTimeout, afterSecondTimeout: button.textContent };
      } finally {
        window.setTimeout = originalSetTimeout;
        window.clearTimeout = originalClearTimeout;
      }
    })()`)
  })

  expect(feedback).toEqual({ afterFirstTimeout: 'Copied', afterSecondTimeout: 'Copy' })
})

test('does not show stale Home copy success after switching setup guides', async ({ electronApp }) => {
  await expect.poll(() => electronApp.evaluate(({ webContents }) =>
    webContents.getAllWebContents().some((contents) => contents.getURL().startsWith('hronaut://home'))
  )).toBe(true)

  const feedback = await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return home.executeJavaScript(`(async () => {
      const copyButton = document.querySelector('[data-copy-target="guide-code"]');
      copyButton.click();
      document.querySelector('[data-guide="gemini-cli"]').click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        copyLabel: copyButton.textContent,
        guideName: document.getElementById('guide-name').textContent
      };
    })()`)
  })

  expect(feedback).toEqual({ copyLabel: 'Copy', guideName: 'Gemini CLI' })
})

test('keeps keyboard focus and selection state when switching Home setup guides', async ({ electronApp }) => {
  await expect.poll(() => electronApp.evaluate(({ webContents }) =>
    webContents.getAllWebContents().some((contents) => contents.getURL().startsWith('hronaut://home'))
  )).toBe(true)

  const selection = await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return home.executeJavaScript(`(() => {
      const button = document.querySelector('[data-guide="opencode"]');
      button.focus();
      button.click();
      const selected = document.querySelector('[data-guide="opencode"]');
      return {
        activeGuide: document.activeElement?.dataset?.guide ?? null,
        selected: selected?.getAttribute('aria-pressed') ?? null,
        guideName: document.getElementById('guide-name').textContent
      };
    })()`)
  })

  expect(selection).toEqual({
    activeGuide: 'opencode',
    selected: 'true',
    guideName: 'OpenCode'
  })
})

test('shows an error status when the MCP port is already in use', async ({
  mcpPort,
  profileDirectory
}) => {
  const portOwner = createServer()
  await new Promise<void>((resolve, reject) => {
    portOwner.once('error', reject)
    portOwner.listen(mcpPort, '127.0.0.1', () => resolve())
  })

  let conflictingApp: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    conflictingApp = await launchHronaut(profileDirectory, mcpPort)
    const statusPill = conflictingApp.window.getByRole('button', { name: 'MCP error' })
    await expect(statusPill).toBeVisible()
    await expect(statusPill).toHaveAttribute('title', /EADDRINUSE/)
    await expect(conflictingApp.window.locator('.mcp-controls')).toHaveClass(/error/)
    await expect(conflictingApp.window.getByRole('button', { name: 'Pause agents' })).toBeDisabled()

    await expect
      .poll(() => conflictingApp!.window.evaluate('window.hronautMcp.getState()'))
      .toMatchObject({ status: 'error', paused: false, error: expect.stringContaining('EADDRINUSE') })

    await expect
      .poll(() => conflictingApp!.app.evaluate(async ({ webContents }) => {
        const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
        return home?.executeJavaScript(`fetch('/api/status').then((response) => response.json())`)
      }))
      .toMatchObject({ status: 'error', error: expect.stringContaining('EADDRINUSE') })
  } finally {
    if (conflictingApp) await closeHronaut(conflictingApp.app)
    await new Promise<void>((resolve) => portOwner.close(() => resolve()))
  }
})

test('keeps the tab strip but removes website navigation controls on Home', async ({ appWindow, electronApp }) => {
  const browserViewBounds = (): Promise<{ x: number; y: number; width: number; height: number } | undefined> => electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows()[0]?.contentView.children[0]?.getBounds()
  ))
  const browserViewY = async (): Promise<number | undefined> => (await browserViewBounds())?.y
  const globalControlPositions = (): Promise<Record<string, { x: number; y: number }>> => appWindow.evaluate(`(() => {
    const labels = ['Search tabs', 'Downloads', 'Browsing history', 'Settings']
    return Object.fromEntries(labels.map((label) => {
      const element = document.querySelector('.topbar-actions button[aria-label="' + label + '"]')
      if (!element) throw new Error('Missing global control: ' + label)
      const bounds = element.getBoundingClientRect()
      return [label, { x: Math.round(bounds.x), y: Math.round(bounds.y) }]
    }))
  })()`) as Promise<Record<string, { x: number; y: number }>>
  await expect(appWindow.getByRole('tab')).toHaveCount(0)
  await expect(appWindow.locator('.toolbar')).toBeHidden()
  await expect.poll(browserViewY).toBe(45)
  const homeGlobalPositions = await globalControlPositions()
  const homeButton = appWindow.getByRole('button', { name: 'Open Hronaut Home' })
  await expect(homeButton).toHaveAttribute('aria-current', 'page')
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await expect(appWindow.getByRole('tab')).toHaveCount(1)
  await expect(appWindow.locator('.toolbar')).toBeVisible()
  await expect.poll(browserViewY).toBe(105)
  expect(await globalControlPositions()).toEqual(homeGlobalPositions)
  for (const label of ['Downloads', 'Browsing history', 'Settings']) {
    await expect(appWindow.locator('.toolbar').getByRole('button', { name: label, exact: true })).toHaveCount(0)
  }
  for (const label of ['Back', 'Forward', 'Address', 'Find in page', 'Page zoom controls', 'Bookmarks', 'Page tools']) {
    if (label === 'Address') await expect(appWindow.locator('.toolbar').getByRole('combobox', { name: label })).toBeVisible()
    else await expect(appWindow.locator('.toolbar').getByRole('button', { name: label, exact: true })).toBeVisible()
  }
  await expect(appWindow.locator('.tab')).toContainText('New tab')
  await expect(appWindow.locator('.tab')).toHaveAttribute('aria-selected', 'true')
  await expect(homeButton).not.toHaveAttribute('aria-current', 'page')
  await homeButton.click()
  await expect(appWindow.getByRole('tab')).toHaveCount(1)
  await expect(appWindow.locator('.toolbar')).toBeHidden()
  await expect.poll(browserViewY).toBe(45)
  expect(await globalControlPositions()).toEqual(homeGlobalPositions)
  await expect(homeButton).toHaveAttribute('aria-current', 'page')

  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(760, 600))
  await expect.poll(() => appWindow.evaluate('window.innerWidth')).toBe(760)
  const compactHomeGlobalPositions = await globalControlPositions()
  await appWindow.getByRole('tab').click()
  await expect(appWindow.locator('.toolbar')).toBeVisible()
  expect(await globalControlPositions()).toEqual(compactHomeGlobalPositions)
  const compactToolbar = await appWindow.locator('.toolbar').evaluate((toolbar) => {
    const address = toolbar.querySelector('.address-form')!.getBoundingClientRect()
    const pageTools = toolbar.querySelector('[aria-label="Page tools"]')!.getBoundingClientRect()
    return {
      clientWidth: toolbar.clientWidth,
      scrollWidth: toolbar.scrollWidth,
      addressWidth: Math.round(address.width),
      pageToolsRight: Math.round(pageTools.right),
      viewportWidth: toolbar.ownerDocument.defaultView!.innerWidth
    }
  })
  expect(compactToolbar.scrollWidth).toBeLessThanOrEqual(compactToolbar.clientWidth)
  expect(compactToolbar.addressWidth).toBeGreaterThanOrEqual(180)
  expect(compactToolbar.pageToolsRight).toBeLessThanOrEqual(compactToolbar.viewportWidth - 12)
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
  await expect(pageTools).toBeVisible()
  const pageToolsBounds = await pageTools.boundingBox()
  expect(pageToolsBounds).not.toBeNull()
  await expect.poll(browserViewBounds).toMatchObject({
    x: 0,
    y: 105,
    width: Math.round(pageToolsBounds!.x)
  })
  for (const label of ['Site storage is unavailable', 'Responsive preview: Test phones, tablets, and desktops', 'Environment: Network, cache, service workers, CPU, animations, rendering, runtime, region, identity, and location', 'Open Console', 'Open network monitor', 'Request conditions: none active', 'Quality audit: Accessibility, speed, SEO, security, PWA, and browser issues', 'Run accessibility audit', 'Measure page performance', 'Design overview: Colors, typography, and contrast', 'Page metadata: Search, social, and structured data', 'Security: TLS, certificate, and connection details', 'Code coverage: Find unused JavaScript and CSS', 'JavaScript CPU profile: Find hot JavaScript functions', 'Page memory: Heap, DOM, and allocation diagnostics', 'DOM changes: See what changed after an action', 'Visual compare: Compare the page before and after', 'Select an element to copy for agent', 'Select an element and copy its screenshot', 'Save page as PDF', 'No saved password for this site']) {
    await expect(pageTools.getByRole('button', { name: label })).toBeVisible()
  }
  const pageToolGroups = [
    ['Inspect & simulate', 6],
    ['Diagnose & reproduce', 8],
    ['Audit & optimize', 8],
    ['Export & account', 3]
  ] as const
  expect(await pageTools.getByRole('heading', { level: 3 }).allTextContents()).toEqual(pageToolGroups.map(([name]) => name))
  for (const [name, buttonCount] of pageToolGroups) {
    await expect(pageTools.getByRole('region', { name }).getByRole('button')).toHaveCount(buttonCount)
  }
  await pageTools.getByRole('button', { name: 'Close page tools' }).click()
  await expect.poll(browserViewY).toBe(105)
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: 'Open network monitor' }).click()
  const networkPanel = appWindow.getByRole('dialog', { name: 'Network' })
  await expect(networkPanel).toBeVisible()
  const networkPanelBounds = await networkPanel.boundingBox()
  expect(networkPanelBounds).not.toBeNull()
  await expect.poll(browserViewBounds).toMatchObject({
    x: 0,
    y: 105,
    width: Math.round(networkPanelBounds!.x)
  })
  await networkPanel.getByRole('button', { name: 'Close network monitor' }).click()
  await expect.poll(browserViewY).toBe(105)

  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const dockPicker = appWindow.getByRole('combobox', { name: 'Dock page tools' })
  await dockPicker.selectOption('left')
  await expect.poll(browserViewBounds).toMatchObject({ x: expect.any(Number), y: 105 })
  const leftPanelBounds = await pageTools.boundingBox()
  expect((await browserViewBounds())?.x).toBe(Math.round(leftPanelBounds!.width))
  await dockPicker.selectOption('bottom')
  const bottomPanelBounds = await pageTools.boundingBox()
  await expect.poll(browserViewBounds).toMatchObject({ x: 0, y: 105 })
  expect((await browserViewBounds())?.height).toBe(Math.round(bottomPanelBounds!.y - 105))
  await dockPicker.selectOption('top')
  const topPanelBounds = await pageTools.boundingBox()
  await expect.poll(browserViewBounds).toMatchObject({
    x: 0,
    y: Math.round(topPanelBounds!.y + topPanelBounds!.height)
  })
  await dockPicker.selectOption('right')
  await pageTools.getByRole('button', { name: 'Close page tools' }).click()
  await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
  const bookmarksPanel = appWindow.getByRole('dialog', { name: 'Bookmarks' })
  await expect(bookmarksPanel).toBeVisible()
  const bookmarksPanelBounds = await bookmarksPanel.boundingBox()
  expect(bookmarksPanelBounds).not.toBeNull()
  await expect.poll(browserViewBounds).toMatchObject({
    x: 0,
    y: 105,
    width: Math.round(bookmarksPanelBounds!.x)
  })
  await bookmarksPanel.getByRole('button', { name: 'Close bookmarks' }).click()
  await expect.poll(browserViewBounds).toMatchObject({ x: 0, y: 105, width: 760 })
  await homeButton.click()
  await expect(appWindow.locator('.toolbar')).toBeHidden()
  expect(await globalControlPositions()).toEqual(compactHomeGlobalPositions)
})

test('refreshes a reopened Environment panel after its pending apply completes', async ({ appWindow, electronApp }, testInfo) => {
  const createdState = await appWindow.evaluate(`window.hronaut.newTab({
    url: 'data:text/html,<title>Environment pending fixture</title><main>Environment fixture</main>',
    active: true
  })`) as BrowserState
  const tabId = createdState.activeTabId
  if (!tabId) throw new Error('Environment pending fixture did not create an active tab')
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
    state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.loading
  ))`)).toBe(false)
  const state = await appWindow.evaluate('window.hronaut.getState()') as BrowserState

  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  await appWindow.getByRole('dialog', { name: 'Page tools' })
    .getByRole('button', { name: /^Environment:/ })
    .click()
  const environment = appWindow.getByRole('dialog', { name: 'Environment' })
  await environment.getByLabel('Network', { exact: true }).selectOption('offline')

  await electronApp.evaluate(({ ipcMain }, input) => {
    const scope = globalThis as typeof globalThis & { __resolveEnvironmentApply?: () => void }
    ipcMain.removeHandler('browser:set-tab-environment')
    ipcMain.handle('browser:set-tab-environment', (_event, requestedTabId: unknown, value: unknown) => (
      new Promise((resolve) => {
        scope.__resolveEnvironmentApply = () => {
          delete scope.__resolveEnvironmentApply
          const settings = value as BrowserEnvironmentSettings
          const { geolocation, ...environmentSettings } = settings
          resolve({
            ...input.state,
            tabs: input.state.tabs.map((tab) => tab.id === requestedTabId
              ? {
                  ...tab,
                  emulation: {
                    ...tab.emulation,
                    ...environmentSettings,
                    ...(geolocation ? { geolocation } : {})
                  }
                }
              : tab)
          })
        }
      })
    ))
  }, { state })

  await environment.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(environment).toHaveAttribute('aria-busy', 'true')
  await environment.getByRole('button', { name: 'Close Environment' }).click()
  await expect(environment).toBeHidden()

  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  await appWindow.getByRole('dialog', { name: 'Page tools' })
    .getByRole('button', { name: /^Environment:/ })
    .click()
  await expect(environment.getByLabel('Network', { exact: true })).toHaveValue('none')

  await electronApp.evaluate(() => {
    const resolve = (globalThis as typeof globalThis & { __resolveEnvironmentApply?: () => void }).__resolveEnvironmentApply
    if (!resolve) throw new Error('Pending Environment apply was not captured')
    resolve()
  })
  await expect(environment.getByLabel('Network', { exact: true })).toHaveValue('offline')
  await expect(environment.locator('.environment-status')).toContainText('Environment applied')
  await appWindow.screenshot({ path: testInfo.outputPath('environment-reopened-after-pending-apply.png') })
})

test('refreshes a reopened Responsive preview after its pending apply completes', async ({ appWindow, electronApp }, testInfo) => {
  const createdState = await appWindow.evaluate(`window.hronaut.newTab({
    url: 'data:text/html,<title>Responsive pending fixture</title><main>Responsive fixture</main>',
    active: true
  })`) as BrowserState
  const tabId = createdState.activeTabId
  if (!tabId) throw new Error('Responsive pending fixture did not create an active tab')
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
    state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.loading
  ))`)).toBe(false)
  const state = await appWindow.evaluate('window.hronaut.getState()') as BrowserState

  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  await appWindow.getByRole('dialog', { name: 'Page tools' })
    .getByRole('button', { name: /^Responsive preview:/ })
    .click()
  const responsive = appWindow.getByRole('dialog', { name: 'Responsive preview' })
  const tablet = responsive.getByRole('button', { name: /^Tablet/ })
  await tablet.click()

  await electronApp.evaluate(({ ipcMain }, input) => {
    const scope = globalThis as typeof globalThis & { __resolveResponsiveApply?: () => void }
    ipcMain.removeHandler('browser:set-tab-viewport')
    ipcMain.handle('browser:set-tab-viewport', (_event, requestedTabId: unknown, value: unknown) => (
      new Promise((resolve) => {
        scope.__resolveResponsiveApply = () => {
          delete scope.__resolveResponsiveApply
          const viewport = value as BrowserViewportEmulation
          resolve({
            ...input.state,
            tabs: input.state.tabs.map((tab) => tab.id === requestedTabId
              ? { ...tab, emulation: { ...tab.emulation, viewport } }
              : tab)
          })
        }
      })
    ))
  }, { state })

  await responsive.getByRole('button', { name: 'Apply preview' }).click()
  await expect(responsive).toHaveAttribute('aria-busy', 'true')
  await responsive.getByRole('button', { name: 'Close responsive preview' }).click()
  await expect(responsive).toBeHidden()

  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  await appWindow.getByRole('dialog', { name: 'Page tools' })
    .getByRole('button', { name: /^Responsive preview:/ })
    .click()
  await expect(tablet).toHaveAttribute('aria-pressed', 'false')

  await electronApp.evaluate(() => {
    const resolve = (globalThis as typeof globalThis & { __resolveResponsiveApply?: () => void }).__resolveResponsiveApply
    if (!resolve) throw new Error('Pending Responsive preview apply was not captured')
    resolve()
  })
  await expect(tablet).toHaveAttribute('aria-pressed', 'true')
  await expect(responsive).toContainText('Viewport applied')
  await appWindow.screenshot({ path: testInfo.outputPath('responsive-reopened-after-pending-apply.png') })
})

test('keeps the latest rapid tab selection when queued responses settle in request order', async ({
  appWindow,
  electronApp
}) => {
  await appWindow.evaluate(`(async () => {
    await window.hronaut.newTab({ url: 'data:text/html,<title>First queued tab</title>', active: false });
    await window.hronaut.newTab({ url: 'data:text/html,<title>Latest queued tab</title>', active: false });
  })()`)
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
    state.tabs.filter((tab) => tab.title.endsWith('queued tab')).length
  ))`)).toBe(2)
  const initialState = await appWindow.evaluate('window.hronaut.getState()') as BrowserState

  await electronApp.evaluate(({ ipcMain }, state) => {
    const mainGlobal = globalThis as typeof globalThis & {
      __queuedTabSelections?: {
        initial: BrowserState
        requests: Array<{ tabId: string; resolve: (value: BrowserState) => void }>
      }
    }
    const control = {
      initial: state as BrowserState,
      requests: [] as Array<{ tabId: string; resolve: (value: BrowserState) => void }>
    }
    mainGlobal.__queuedTabSelections = control
    ipcMain.removeHandler('browser:select-tab')
    ipcMain.handle('browser:select-tab', (_event, tabId: unknown) => new Promise((resolve) => {
      control.requests.push({ tabId: String(tabId), resolve })
    }))
  }, initialState)

  const firstTab = appWindow.getByRole('tab', { name: /^First queued tab/ })
  const latestTab = appWindow.getByRole('tab', { name: /^Latest queued tab/ })
  await firstTab.click()
  await latestTab.click()
  await expect.poll(() => electronApp.evaluate(() => (
    globalThis as typeof globalThis & {
      __queuedTabSelections?: { requests: unknown[] }
    }
  ).__queuedTabSelections?.requests.length)).toBe(2)

  await electronApp.evaluate(() => {
    const control = (globalThis as typeof globalThis & {
      __queuedTabSelections?: {
        initial: BrowserState
        requests: Array<{ tabId: string; resolve: (value: BrowserState) => void }>
      }
    }).__queuedTabSelections
    if (!control || control.requests.length !== 2) throw new Error('Tab selections were not queued')
    for (const request of control.requests) {
      request.resolve({
        ...control.initial,
        activeTabId: request.tabId,
        tabs: control.initial.tabs.map((tab) => ({ ...tab, active: tab.id === request.tabId }))
      })
    }
  })

  await expect(latestTab).toHaveAttribute('aria-selected', 'true')
  await expect(firstTab).toHaveAttribute('aria-selected', 'false')
})

test('coalesces rapid detached-panel requests and refreshes only the latest panel', async ({ appWindow, electronApp }) => {
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  const detachedPagePromise = electronApp.waitForEvent('window')
  await appWindow.evaluate(`Promise.all([
    window.hronautPanelWindow.open('console'),
    window.hronautPanelWindow.open('network')
  ])`)
  await detachedPagePromise

  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
  await expect.poll(() => electronApp.windows().map((page) => page.url())).toContainEqual(expect.stringContaining('hronautPanel='))
  const detachedPage = electronApp.windows().find((page) => page.url().includes('hronautPanel='))
  if (!detachedPage) throw new Error('Missing serialized detached panel page')
  await expect(detachedPage).toHaveTitle('Network monitor — Hronaut')
  await expect(detachedPage.getByRole('dialog', { name: 'Network' })).toBeVisible()

  await electronApp.evaluate(({ BrowserWindow, ipcMain }) => {
    const mainGlobal = globalThis as typeof globalThis & {
      __hronautRapidPanelRefreshes?: { console: number; network: number; routes: number }
    }
    const counts = { console: 0, network: 0, routes: 0 }
    mainGlobal.__hronautRapidPanelRefreshes = counts
    ipcMain.removeHandler('browser:console')
    ipcMain.handle('browser:console', () => {
      counts.console += 1
      return []
    })
    ipcMain.removeHandler('browser:network')
    ipcMain.handle('browser:network', () => {
      counts.network += 1
      return []
    })
    ipcMain.removeHandler('browser:list-network-routes')
    ipcMain.handle('browser:list-network-routes', () => {
      counts.routes += 1
      return []
    })
    const panel = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Network monitor — Hronaut')
    if (!panel) throw new Error('Missing serialized network panel')
    panel.webContents.send('panel-window:show-panel', 'console')
    panel.webContents.send('panel-window:show-panel', 'network')
  })

  await expect(detachedPage).toHaveTitle('Network monitor — Hronaut')
  await expect(detachedPage.getByRole('dialog', { name: 'Network' })).toBeVisible()
  await expect.poll(() => electronApp.evaluate(() => (
    (globalThis as typeof globalThis & {
      __hronautRapidPanelRefreshes?: { console: number; network: number; routes: number }
    }).__hronautRapidPanelRefreshes
  ))).toEqual({ console: 0, network: 1, routes: 1 })

  const changedPanelContext = await appWindow.evaluate(async () => {
    const page = window as unknown as { hronaut: { getState: () => Promise<BrowserState> } }
    const next = await page.hronaut.getState()
    return {
      ...next,
      tabs: next.tabs.map((tab) => tab.id === next.activeTabId
        ? { ...tab, url: `${tab.url}#detached-panel-context-change`, loading: false }
        : tab)
    }
  }) as BrowserState
  await electronApp.evaluate(({ BrowserWindow }, context) => {
    const panel = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Network monitor — Hronaut')
    if (!panel) throw new Error('Missing serialized network panel')
    panel.webContents.send('panel-window:show-panel', 'console')
    panel.webContents.send('browser:state-changed', context)
  }, changedPanelContext)

  await expect(detachedPage).toHaveTitle('Console — Hronaut')
  await expect(detachedPage.getByRole('dialog', { name: 'Console' })).toBeVisible()
  await expect.poll(() => electronApp.evaluate(() => (
    (globalThis as typeof globalThis & {
      __hronautRapidPanelRefreshes?: { console: number; network: number; routes: number }
    }).__hronautRapidPanelRefreshes?.console
  ))).toBeGreaterThan(0)

  await electronApp.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Console — Hronaut')
    if (!panel) throw new Error('Missing serialized console panel')
    panel.close()
  })
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
})

test('recovers a docked panel when opening its detached window fails', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(() => {
    type RejectionEvent = { reason: unknown; preventDefault: () => void }
    const shellWindow = globalThis as typeof globalThis & {
      __hronautUnhandledPanelSyncRejection?: string | null
      __hronautUnhandledPanelSyncListener?: (event: RejectionEvent) => void
      addEventListener: (type: string, listener: (event: RejectionEvent) => void) => void
    }
    shellWindow.__hronautUnhandledPanelSyncRejection = null
    shellWindow.__hronautUnhandledPanelSyncListener = (event) => {
      shellWindow.__hronautUnhandledPanelSyncRejection = event.reason instanceof Error
        ? event.reason.message
        : String(event.reason)
      event.preventDefault()
    }
    shellWindow.addEventListener('unhandledrejection', shellWindow.__hronautUnhandledPanelSyncListener)
  })
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('panel-window:open')
    ipcMain.handle('panel-window:open', () => {
      throw new Error('Detached panel unavailable for regression test')
    })
  })

  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
  const dockPicker = pageTools.getByRole('combobox', { name: 'Dock page tools' })
  await expect(dockPicker).toHaveValue('right')
  await dockPicker.selectOption('window')

  await expect(appWindow.getByRole('alert', { name: 'Browser action failed' }))
    .toContainText('Detached panel unavailable for regression test')
  await expect(dockPicker).toHaveValue('right')
  await expect(pageTools).toBeVisible()
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  expect(await appWindow.evaluate(() => {
    type RejectionEvent = { reason: unknown; preventDefault: () => void }
    const shellWindow = globalThis as typeof globalThis & {
      __hronautUnhandledPanelSyncRejection?: string | null
      __hronautUnhandledPanelSyncListener?: (event: RejectionEvent) => void
      removeEventListener: (type: string, listener: (event: RejectionEvent) => void) => void
    }
    const rejection = shellWindow.__hronautUnhandledPanelSyncRejection
    if (shellWindow.__hronautUnhandledPanelSyncListener) {
      shellWindow.removeEventListener('unhandledrejection', shellWindow.__hronautUnhandledPanelSyncListener)
    }
    delete shellWindow.__hronautUnhandledPanelSyncRejection
    delete shellWindow.__hronautUnhandledPanelSyncListener
    return rejection
  })).toBeNull()
})

test('switches detached panels exclusively without resurrecting the previous surface', async ({
  appWindow,
  electronApp
}) => {
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const detachedPagePromise = electronApp.waitForEvent('window')
  await appWindow.getByRole('dialog', { name: 'Page tools' })
    .getByRole('combobox', { name: 'Dock page tools' })
    .selectOption('window')
  const detachedPage = await detachedPagePromise
  await detachedPage.waitForLoadState('domcontentloaded')
  await expect(detachedPage.getByRole('dialog', { name: 'Page tools' })).toBeVisible()

  await detachedPage.getByRole('button', { name: 'Open Console' }).click()

  await expect(detachedPage).toHaveTitle('Console — Hronaut')
  await expect(detachedPage.getByRole('dialog', { name: 'Console' })).toBeVisible()
  await expect(detachedPage.getByRole('dialog', { name: 'Page tools' })).toBeHidden()

  const detachedClosed = detachedPage.waitForEvent('close')
  await detachedPage.evaluate(`setTimeout(() => {
    const close = document.querySelector('button[aria-label="Close Console"]')
    if (!(close instanceof HTMLButtonElement)) throw new Error('Missing detached Console close button')
    close.click()
  }, 0)`)
  await detachedClosed
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
})

test('detaches tool panels into a hardened window and redocks them', async ({ appWindow, electronApp }) => {
  const browserViewBounds = (): Promise<{ x: number; y: number; width: number; height: number } | undefined> => electronApp.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')
    return main?.contentView.children[0]?.getBounds()
  })

  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await expect(appWindow.locator('.toolbar')).toBeVisible()
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const dockedPageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
  await expect(dockedPageTools).toBeVisible()
  const dockedBounds = await dockedPageTools.boundingBox()
  expect(dockedBounds).not.toBeNull()
  await expect.poll(browserViewBounds).toMatchObject({ width: Math.round(dockedBounds!.x) })

  const detachedPagePromise = electronApp.waitForEvent('window')
  await dockedPageTools.getByRole('combobox', { name: 'Dock page tools' }).selectOption('window')
  const detachedPage = await detachedPagePromise
  await detachedPage.waitForLoadState('domcontentloaded')
  detachedPage.on('pageerror', (error) => console.error(`[detached renderer] ${error.message}`))
  await expect(detachedPage).toHaveTitle('Page tools — Hronaut')
  await expect(detachedPage.locator('html')).toHaveAttribute('data-title-bar-mode', 'system')
  await expect(detachedPage.locator('.shell')).not.toHaveClass(/custom-title-bar/)
  await expect(detachedPage.locator('[data-titlebar-drag-surface]')).toHaveCount(0)
  await expect(detachedPage.getByRole('dialog', { name: 'Page tools' })).toBeVisible()
  await expect(dockedPageTools).toBeHidden()
  await expect.poll(browserViewBounds).toMatchObject({ x: 0, y: 105, width: await appWindow.evaluate('window.innerWidth') })
  await expect(detachedPage.getByRole('combobox', { name: 'Dock page tools' })).toHaveValue('window')

  const detachedSecurity = await electronApp.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Page tools — Hronaut')
    const preferences = (panel?.webContents as unknown as {
      getLastWebPreferences?: () => { contextIsolation?: boolean; nodeIntegration?: boolean; sandbox?: boolean }
    } | undefined)?.getLastWebPreferences?.()
    return {
      windows: BrowserWindow.getAllWindows().length,
      url: panel?.webContents.getURL(),
      contextIsolation: preferences?.contextIsolation,
      nodeIntegration: preferences?.nodeIntegration,
      sandbox: preferences?.sandbox
    }
  })
  expect(detachedSecurity).toMatchObject({
    windows: 2,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  })
  expect(detachedSecurity.url).toContain('hronautPanel=page-tools')

  const detachedTargetState = await appWindow.evaluate(`window.hronaut.newTab({
    url: 'data:text/html,<title>Detached panel target</title>',
    active: true
  })`) as { activeTabId: string | null }
  await expect.poll(() => detachedPage.evaluate('window.hronaut.getState().then((state) => state.activeTabId)'))
    .toBe(detachedTargetState.activeTabId)
  await expect(detachedPage.getByRole('dialog', { name: 'Page tools' })).toBeVisible()

  const homeTabId = await appWindow.evaluate(`window.hronaut.getState().then((state) => {
    const home = state.tabs.find((tab) => tab.url.startsWith('hronaut://home'))
    if (!home) throw new Error('Missing Home tab')
    return home.id
  })`) as string
  await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(homeTabId)})`)
  const detachedWebsiteRequired = detachedPage.getByRole('dialog', { name: 'Page tools' })
  await expect(detachedWebsiteRequired.getByRole('heading', { name: 'Open a website tab' })).toBeVisible()
  await expect(detachedWebsiteRequired).toContainText('This panel will refresh automatically.')

  await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(detachedTargetState.activeTabId)})`)
  await expect(detachedPage.getByRole('heading', { name: 'Open a website tab' })).toBeHidden()
  await expect(detachedPage.getByRole('dialog', { name: 'Page tools' })).toBeVisible()

  const trustedPanelUrl = detachedPage.url()
  await detachedPage.evaluate("location.assign('https://example.com/blocked-panel-navigation')")
  await expect.poll(() => detachedPage.url()).toBe(trustedPanelUrl)
  expect(await detachedPage.evaluate("window.open('https://example.com/blocked-panel-popup') === null")).toBe(true)
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
  const rememberedPanelSize = await electronApp.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Page tools — Hronaut')
    panel?.setSize(610, 650)
    const bounds = panel?.getNormalBounds()
    return { width: bounds?.width, height: bounds?.height }
  })
  expect(rememberedPanelSize).toEqual({ width: 610, height: 650 })

  const detachedClosed = detachedPage.waitForEvent('close')
  await detachedPage.evaluate(`setTimeout(() => {
    const select = document.querySelector('select[aria-label="Dock page tools"]')
    if (!(select instanceof HTMLSelectElement)) throw new Error('Missing page-tools dock selector')
    select.value = 'left'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }, 0)`)
  await detachedClosed
  await expect(dockedPageTools).toBeVisible()
  await expect(dockedPageTools.getByRole('combobox', { name: 'Dock page tools' })).toHaveValue('left')
  const leftBounds = await dockedPageTools.boundingBox()
  await expect.poll(browserViewBounds).toMatchObject({ x: Math.round(leftBounds!.width), y: 105 })

  await dockedPageTools.getByRole('combobox', { name: 'Dock page tools' }).selectOption('right')
  await dockedPageTools.getByRole('button', { name: 'Close page tools' }).click()
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  await appWindow.getByRole('dialog', { name: 'Page tools' })
    .getByRole('button', { name: 'Responsive preview: Test phones, tablets, and desktops' }).click()
  const dockedResponsive = appWindow.getByRole('dialog', { name: 'Responsive preview' })
  const detachedResponsivePromise = electronApp.waitForEvent('window')
  await dockedResponsive.getByRole('combobox', { name: 'Dock responsive preview' }).selectOption('window')
  const detachedResponsive = await detachedResponsivePromise
  await detachedResponsive.waitForLoadState('domcontentloaded')
  await expect(detachedResponsive).toHaveTitle('Responsive preview — Hronaut')
  await expect(detachedResponsive.getByRole('dialog', { name: 'Responsive preview' })).toBeVisible()

  const previousTabId = await appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).not.toBe(previousTabId)
  const nextTabId = await appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')
  await expect.poll(() => detachedResponsive.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(nextTabId)
  await expect(detachedResponsive.getByRole('dialog', { name: 'Responsive preview' })).toBeVisible()

  const detachedResponsiveClosed = detachedResponsive.waitForEvent('close')
  await detachedResponsive.evaluate(`setTimeout(() => {
    const select = document.querySelector('select[aria-label="Dock responsive preview"]')
    if (!(select instanceof HTMLSelectElement)) throw new Error('Missing responsive-preview dock selector')
    select.value = 'right'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }, 0)`)
  await detachedResponsiveClosed
  await expect(dockedResponsive).toBeVisible()
  await dockedResponsive.getByRole('button', { name: 'Close responsive preview' }).click()
  await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
  const dockedBookmarks = appWindow.getByRole('dialog', { name: 'Bookmarks' })
  const detachedBookmarksPromise = electronApp.waitForEvent('window')
  await dockedBookmarks.getByRole('combobox', { name: 'Dock bookmarks' }).selectOption('window')
  const detachedBookmarks = await detachedBookmarksPromise
  await detachedBookmarks.waitForLoadState('domcontentloaded')
  await expect(detachedBookmarks).toHaveTitle('Bookmarks — Hronaut')
  await expect(detachedBookmarks.getByRole('dialog', { name: 'Bookmarks' })).toBeVisible()
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Bookmarks — Hronaut')
    const bounds = panel?.getNormalBounds()
    return { width: bounds?.width, height: bounds?.height }
  })).toEqual(rememberedPanelSize)
  await detachedBookmarks.evaluate(`setTimeout(() => {
    const button = document.querySelector('button[aria-label="Close bookmarks"]')
    if (!(button instanceof HTMLButtonElement)) throw new Error('Missing bookmarks close button')
    button.click()
  }, 0)`)
  await expect.poll(() => detachedBookmarks.isClosed()).toBe(true)
  await expect(dockedBookmarks).toBeHidden()
  await expect.poll(browserViewBounds).toMatchObject({ x: 0, y: 105, width: await appWindow.evaluate('window.innerWidth') })
})

test('resizes docked panels by pointer and keyboard while preserving page space', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')?.setContentSize(1200, 800)
  })
  await expect.poll(() => appWindow.evaluate('({ width: window.innerWidth, height: window.innerHeight })')).toEqual({ width: 1200, height: 800 })
  const browserViewBounds = (): Promise<{ x: number; y: number; width: number; height: number } | undefined> => electronApp.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')
    return main?.contentView.children[0]?.getBounds()
  })

  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const panel = appWindow.getByRole('dialog', { name: 'Page tools' })
  const handle = appWindow.getByRole('separator', { name: 'Resize docked panel' })
  await expect(handle).toHaveAttribute('aria-orientation', 'vertical')
  const initialPanelBounds = await panel.boundingBox()
  const handleBounds = await handle.boundingBox()
  expect(initialPanelBounds).not.toBeNull()
  expect(handleBounds).not.toBeNull()

  // A detached-window redock event can change the dock while a native pointer
  // gesture is still active. The gesture must finish on its original axis.
  const interruptedStartX = handleBounds!.x + handleBounds!.width / 2
  await appWindow.mouse.move(interruptedStartX, handleBounds!.y + 80)
  await appWindow.mouse.down()
  await appWindow.mouse.move(interruptedStartX - 32, handleBounds!.y + 80)
  await panel.getByRole('combobox', { name: 'Dock page tools' }).evaluate((select) => {
    const target = select as unknown as { value: string; dispatchEvent(event: unknown): void }
    target.value = 'bottom'
    target.dispatchEvent(new select.ownerDocument.defaultView!.Event('change', { bubbles: true }))
  })
  await expect(handle).not.toHaveClass(/active/)
  expect(await appWindow.evaluate("localStorage.getItem('hronaut:panel-dock-size-horizontal')"))
    .toBe(String(Math.round(initialPanelBounds!.width + 32)))
  expect(await appWindow.evaluate("localStorage.getItem('hronaut:panel-dock-size-vertical')")).toBeNull()
  await appWindow.mouse.up()
  await panel.getByRole('combobox', { name: 'Dock page tools' }).selectOption('right')
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(Math.round(initialPanelBounds!.width + 32))
  const pointerSize = Math.round((await panel.boundingBox())!.width)
  expect(await appWindow.evaluate("localStorage.getItem('hronaut:panel-dock-size-horizontal')")).toBe(String(pointerSize))

  await handle.focus()
  await handle.press('ArrowRight')
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(pointerSize - 16)
  await handle.press('Shift+ArrowLeft')
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(pointerSize + 32)
  const keyboardSize = Math.round((await panel.boundingBox())!.width)
  await panel.getByRole('button', { name: 'Close page tools' }).click()
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(keyboardSize)

  await panel.getByRole('combobox', { name: 'Dock page tools' }).selectOption('bottom')
  await expect(handle).toHaveAttribute('aria-orientation', 'horizontal')
  await handle.focus()
  await handle.press('Home')
  await expect.poll(async () => Math.round((await panel.boundingBox())!.height)).toBe(240)
  await handle.press('End')
  const maximumBottomSize = Number(await handle.getAttribute('aria-valuemax'))
  await expect.poll(async () => Math.round((await panel.boundingBox())!.height)).toBe(maximumBottomSize)
  const pageBoundsAtMaximum = await browserViewBounds()
  expect(pageBoundsAtMaximum!.height).toBeGreaterThanOrEqual(220)
  await handle.dblclick()
  expect(await appWindow.evaluate("localStorage.getItem('hronaut:panel-dock-size-vertical')")).toBeNull()
  await expect.poll(async () => Math.round((await panel.boundingBox())!.height)).toBe(Math.round(800 * 0.45))
  await panel.getByRole('combobox', { name: 'Dock page tools' }).selectOption('left')
  await handle.focus()
  await handle.press('Home')
  await handle.press('ArrowRight')
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(336)
  await panel.getByRole('combobox', { name: 'Dock page tools' }).selectOption('top')
  await handle.focus()
  await handle.press('Home')
  await handle.press('ArrowDown')
  await expect.poll(async () => Math.round((await panel.boundingBox())!.height)).toBe(256)
})

test('restores horizontal and vertical dock sizes after restart', async ({ profileDirectory, mcpPort }) => {
  const first = await launchHronaut(profileDirectory, mcpPort)
  let second: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    await first.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')?.setContentSize(1200, 800)
    })
    await expect.poll(() => first.window.evaluate('({ width: window.innerWidth, height: window.innerHeight })')).toEqual({ width: 1200, height: 800 })
    await first.window.getByRole('button', { name: 'New tab' }).click()
    await first.window.getByRole('button', { name: 'Page tools' }).click()
    const firstPanel = first.window.getByRole('dialog', { name: 'Page tools' })
    const firstHandle = first.window.getByRole('separator', { name: 'Resize docked panel' })
    await firstHandle.focus()
    await firstHandle.press('Shift+ArrowLeft')
    const horizontalSize = Math.round((await firstPanel.boundingBox())!.width)
    await firstPanel.getByRole('combobox', { name: 'Dock page tools' }).selectOption('bottom')
    await firstHandle.focus()
    await firstHandle.press('Shift+ArrowUp')
    const verticalSize = Math.round((await firstPanel.boundingBox())!.height)
    await closeHronaut(first.app)

    second = await launchHronaut(profileDirectory, mcpPort)
    await second.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')?.setContentSize(1200, 800)
    })
    await expect.poll(() => second!.window.evaluate('({ width: window.innerWidth, height: window.innerHeight })')).toEqual({ width: 1200, height: 800 })
    await second.window.getByRole('button', { name: 'Page tools' }).click()
    const restoredPanel = second.window.getByRole('dialog', { name: 'Page tools' })
    await expect(restoredPanel.getByRole('combobox', { name: 'Dock page tools' })).toHaveValue('bottom')
    await expect.poll(async () => Math.round((await restoredPanel.boundingBox())!.height)).toBe(verticalSize)
    await restoredPanel.getByRole('combobox', { name: 'Dock page tools' }).selectOption('right')
    await expect.poll(async () => Math.round((await restoredPanel.boundingBox())!.width)).toBe(horizontalSize)
  } finally {
    if (second) await closeHronaut(second.app)
    else await closeHronaut(first.app)
  }
})

test('keeps per-site controls above the website view', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Site controls fixture</title><main>Website content</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port')
    const url = `http://127.0.0.1:${address.port}/site-controls`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.url)')).toBe(url)

    const browserViewBounds = (): Promise<{ x: number; y: number; width: number; height: number } | undefined> => electronApp.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows()[0]?.contentView.children[0]?.getBounds()
    ))
    const browserViewY = async (): Promise<number | undefined> => (await browserViewBounds())?.y
    await expect.poll(browserViewY).toBe(105)

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' })
      .getByRole('button', { name: /Responsive preview:/ })
      .click()
    const responsivePreview = appWindow.getByRole('dialog', { name: 'Responsive preview' })
    await expect(responsivePreview).toBeVisible()

    await appWindow.getByRole('button', { name: /Site controls for 127\.0\.0\.1/ }).click()
    const siteControls = appWindow.getByRole('dialog', { name: '127.0.0.1' })
    await expect(siteControls).toBeVisible()
    await expect(responsivePreview).toBeHidden()
    const panelBounds = await siteControls.boundingBox()
    expect(panelBounds).not.toBeNull()
    await expect.poll(browserViewBounds).toMatchObject({ x: 0, y: 105, width: Math.round(panelBounds!.x) })

    await siteControls.getByRole('button', { name: 'Close site controls' }).click()
    await expect.poll(browserViewY).toBe(105)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('closes Find when Page Tools opens', async ({ appWindow }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Page tools transition fixture</title><main>Find this content</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Page Tools transition fixture did not expose a TCP port')
    const url = `http://127.0.0.1:${address.port}/page-tools-transition`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.url)')).toBe(url)

    const find = appWindow.getByRole('search', { name: 'Find in page' })
    await appWindow.getByRole('button', { name: 'Find in page' }).click()
    await expect(find).toBeVisible()

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    await expect(appWindow.getByRole('dialog', { name: 'Page tools' })).toBeVisible()
    await expect(find).toBeHidden()
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('keeps Find, Zoom, Tab Search, and the Split view menu mutually exclusive', async ({ appWindow }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>${request.url}</title><main>Split view Find content</main>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Split view transition fixture did not expose a TCP port')
    const firstUrl = `http://127.0.0.1:${address.port}/split-first`
    const secondUrl = `http://127.0.0.1:${address.port}/split-second`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(firstUrl)}, active: true })`)
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(secondUrl)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.url)')).toBe(secondUrl)

    const find = appWindow.getByRole('search', { name: 'Find in page' })
    await appWindow.getByRole('button', { name: 'Find in page' }).click()
    await expect(find).toBeVisible()

    const splitViewMenu = appWindow.getByRole('dialog', { name: 'Split view' })
    await appWindow.getByRole('button', { name: 'Split view' }).click()
    await expect(splitViewMenu).toBeVisible()
    await expect(find).toBeHidden()

    await appWindow.getByRole('button', { name: 'Find in page' }).click()
    await expect(find).toBeVisible()
    await expect(splitViewMenu).toBeHidden()

    await appWindow.getByRole('button', { name: 'Split view' }).click()
    await expect(splitViewMenu).toBeVisible()
    const tabSearch = appWindow.getByRole('dialog', { name: 'Tabs' })
    await appWindow.getByRole('button', { name: 'Search tabs' }).click()
    await expect(tabSearch).toBeVisible()
    await expect(splitViewMenu).toBeHidden()

    await appWindow.getByRole('button', { name: 'Split view' }).click()
    await expect(splitViewMenu).toBeVisible()
    await expect(tabSearch).toBeHidden()

    const zoom = appWindow.getByRole('group', { name: 'Page zoom controls' })
    await appWindow.getByRole('button', { name: 'Page zoom controls' }).click()
    await expect(zoom).toBeVisible()
    await expect(splitViewMenu).toBeHidden()

    await appWindow.getByRole('button', { name: 'Split view' }).click()
    await expect(splitViewMenu).toBeVisible()
    await expect(zoom).toBeHidden()
  } finally {
    await closeFixtureServer(server)
  }
})

test('does not open Site Controls underneath Settings after delayed Find cleanup', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Site controls race fixture</title><main>Find this content</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Site Controls race fixture did not expose a TCP port')
    const url = `http://127.0.0.1:${address.port}/site-controls-race`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.url)')).toBe(url)
    await appWindow.getByRole('button', { name: 'Find in page' }).click()
    await expect(appWindow.getByRole('search', { name: 'Find in page' })).toBeVisible()

    await electronApp.evaluate(({ ipcMain }) => {
      const mainGlobal = globalThis as typeof globalThis & { __resolveDelayedFindCleanup?: () => void }
      ipcMain.removeHandler('browser:stop-find-in-page')
      ipcMain.handle('browser:stop-find-in-page', () => new Promise<void>(resolve => {
        mainGlobal.__resolveDelayedFindCleanup = resolve
      }))
    })

    const siteControls = appWindow.getByRole('dialog', { name: '127.0.0.1' })
    await appWindow.getByRole('button', { name: /Site controls for 127\.0\.0\.1/ }).click()
    await expect(siteControls).toBeVisible()
    await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(appWindow.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await expect(siteControls).toBeHidden()

    await electronApp.evaluate(() => {
      const mainGlobal = globalThis as typeof globalThis & { __resolveDelayedFindCleanup?: () => void }
      if (!mainGlobal.__resolveDelayedFindCleanup) throw new Error('Delayed Find cleanup did not start')
      mainGlobal.__resolveDelayedFindCleanup()
      delete mainGlobal.__resolveDelayedFindCleanup
    })

    await expect(appWindow.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await expect(siteControls).toBeHidden()
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('opens Privacy immediately and keeps a newer close authoritative after delayed Find cleanup', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Privacy race fixture</title><main>Find this private content</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Privacy race fixture did not expose a TCP port')
    const url = `http://127.0.0.1:${address.port}/privacy-race`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.url)')).toBe(url)
    await appWindow.getByRole('button', { name: 'Find in page' }).click()
    await expect(appWindow.getByRole('search', { name: 'Find in page' })).toBeVisible()

    await electronApp.evaluate(({ ipcMain }) => {
      const mainGlobal = globalThis as typeof globalThis & { __resolveDelayedPrivacyFindCleanup?: () => void }
      ipcMain.removeHandler('browser:stop-find-in-page')
      ipcMain.handle('browser:stop-find-in-page', () => new Promise<void>(resolve => {
        mainGlobal.__resolveDelayedPrivacyFindCleanup = resolve
      }))
    })

    await appWindow.keyboard.press('Control+Shift+Delete')
    const settings = appWindow.getByRole('dialog', { name: 'Settings' })
    await expect(settings).toBeVisible()
    await expect(settings.getByRole('heading', { name: 'Privacy & browsing data' })).toBeVisible()
    await settings.getByRole('button', { name: 'Close settings' }).click()
    await expect(settings).toBeHidden()

    await electronApp.evaluate(() => {
      const mainGlobal = globalThis as typeof globalThis & { __resolveDelayedPrivacyFindCleanup?: () => void }
      if (!mainGlobal.__resolveDelayedPrivacyFindCleanup) throw new Error('Delayed Privacy Find cleanup did not start')
      mainGlobal.__resolveDelayedPrivacyFindCleanup()
      delete mainGlobal.__resolveDelayedPrivacyFindCleanup
    })

    await expect(settings).toBeHidden()
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('does not open Home after a newer tab selection during delayed Find cleanup', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    const newer = request.url === '/newer'
    response.end(`<!doctype html><title>${newer ? 'Newer tab choice' : 'Home race fixture'}</title><main>Find this content</main>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Home race fixture did not expose a TCP port')
    const origin = `http://127.0.0.1:${address.port}`
    const fixtureTabId = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${origin}/fixture`)}, active: true }).then((state) => state.activeTabId)`)
    const newerTabId = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${origin}/newer`)}, active: false }).then((state) => state.tabs.find((tab) => tab.url === ${JSON.stringify(`${origin}/newer`)})?.id)`)
    if (!fixtureTabId || !newerTabId) throw new Error('Home race tabs were not available')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Home race fixture')
    await appWindow.getByRole('button', { name: 'Find in page' }).click()
    await expect(appWindow.getByRole('search', { name: 'Find in page' })).toBeVisible()

    await electronApp.evaluate(({ ipcMain }) => {
      const mainGlobal = globalThis as typeof globalThis & { __resolveDelayedHomeFindCleanup?: () => void }
      ipcMain.removeHandler('browser:stop-find-in-page')
      ipcMain.handle('browser:stop-find-in-page', () => new Promise<void>(resolve => {
        mainGlobal.__resolveDelayedHomeFindCleanup = resolve
      }))
    })

    await appWindow.getByRole('button', { name: 'Open Hronaut Home' }).click()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.url)')).toMatch(/^hronaut:\/\/home/)
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(newerTabId)})`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Newer tab choice')

    await electronApp.evaluate(() => {
      const mainGlobal = globalThis as typeof globalThis & { __resolveDelayedHomeFindCleanup?: () => void }
      if (!mainGlobal.__resolveDelayedHomeFindCleanup) throw new Error('Delayed Home Find cleanup did not start')
      mainGlobal.__resolveDelayedHomeFindCleanup()
      delete mainGlobal.__resolveDelayedHomeFindCleanup
    })

    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Newer tab choice')
  } finally {
    await electronApp.evaluate(() => {
      const mainGlobal = globalThis as typeof globalThis & { __resolveDelayedHomeFindCleanup?: () => void }
      mainGlobal.__resolveDelayedHomeFindCleanup?.()
      delete mainGlobal.__resolveDelayedHomeFindCleanup
    }).catch(() => undefined)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('shows a recoverable site error and retries the failed address', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Recovered website</title><main>Connection restored</main>')
  })
  const listen = (port = 0): Promise<number> => new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('Recovery fixture did not expose a port'))
      else resolve(address.port)
    })
  })
  const close = (): Promise<void> => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  const browserViewY = (): Promise<number | undefined> => electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows()[0]?.contentView.children[0]?.getBounds().y
  ))

  const port = await listen()
  await close()
  const failedUrl = `http://127.0.0.1:${port}/temporarily-unavailable`
  try {
    await appWindow.evaluate('window.hronaut.newTab({ active: true })')
    const address = appWindow.getByRole('combobox', { name: 'Address' })
    await address.fill(failedUrl)
    await address.press('Enter')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.pageProblem)')).toMatchObject({
      kind: 'load-error',
      title: 'This site could not be reached',
      url: failedUrl,
      errorDescription: 'ERR_CONNECTION_REFUSED'
    })
    await expect(appWindow.getByRole('alert', { name: 'Navigation failed' })).toContainText('ERR_CONNECTION_REFUSED')

    const recovery = appWindow.locator('.page-problem-bar')
    await expect(recovery).toContainText('The website refused the connection.')
    await expect(recovery).toContainText('ERR_CONNECTION_REFUSED')
    await expect(appWindow.getByRole('tab')).toHaveAttribute('aria-label', /This site could not be reached/)
    await expect.poll(browserViewY).toBeGreaterThan(105)

    await listen(port)
    await recovery.getByRole('button', { name: 'Try again' }).click()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active))')).toMatchObject({
      title: 'Recovered website',
      url: failedUrl
    })
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.pageProblem ?? null)')).toBeNull()
    await expect(recovery).toBeHidden()
    await expect.poll(browserViewY).toBe(105)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
      return page?.executeJavaScript('document.body.innerText')
    }, failedUrl)).toContain('Connection restored')
  } finally {
    if (server.listening) await close()
  }
})

test('does not report a superseded address navigation as failed', async ({ appWindow }) => {
  let markSlowRequested: (() => void) | undefined
  let markSlowAborted: (() => void) | undefined
  const slowRequested = new Promise<void>((resolve) => {
    markSlowRequested = resolve
  })
  const slowAborted = new Promise<void>((resolve) => {
    markSlowAborted = resolve
  })
  const server = createServer((request, response) => {
    if (request.url === '/slow') {
      request.once('close', () => markSlowAborted?.())
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
      response.write('<!doctype html><title>Slow destination</title><main>Still loading')
      markSlowRequested?.()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end('<!doctype html><title>Fast destination</title><main>Latest address won</main>')
  })
  const address = await new Promise<{ port: number }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address() as { port: number }))
  })

  try {
    await appWindow.evaluate('window.hronaut.newTab({ active: true })')
    const addressInput = appWindow.getByRole('combobox', { name: 'Address' })
    await addressInput.fill(`http://127.0.0.1:${address.port}/slow`)
    await addressInput.press('Enter')
    await slowRequested

    await addressInput.fill(`http://127.0.0.1:${address.port}/fast`)
    await addressInput.press('Enter')
    await slowAborted
    await expect.poll(() => appWindow.evaluate(
      'window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'
    )).toBe('Fast destination')
    await expect(appWindow.getByRole('alert', { name: 'Navigation failed' })).toHaveCount(0)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('treats tab closure as cancellation during address navigation', async ({
  appWindow,
  electronApp
}) => {
  const targetUrl = 'data:text/html,<title>Closing address navigation</title><main>Close this tab while navigating</main>'
  const created = await appWindow.evaluate(`(async () => {
    const target = await window.hronaut.newTab({ url: ${JSON.stringify(targetUrl)}, active: true });
    const targetTabId = target.activeTabId;
    const fallback = await window.hronaut.newTab({ url: 'about:blank', active: false });
    const fallbackTabId = fallback.tabs.find((tab) => tab.id !== targetTabId && tab.url === 'about:blank')?.id;
    return { targetTabId, fallbackTabId };
  })()`) as { targetTabId: string | null; fallbackTabId?: string }
  expect(created.targetTabId).toBeTruthy()
  expect(created.fallbackTabId).toBeTruthy()
  const targetTabId = created.targetTabId!
  const fallbackTabId = created.fallbackTabId!

  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
    state.tabs.find((tab) => tab.id === ${JSON.stringify(targetTabId)})?.loading
  ))`)).toBe(false)
  await electronApp.evaluate(({ webContents }, requestedUrl) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
    if (!page) throw new Error('Closing address-navigation WebContents was not found')
    const control = {
      started: false,
      finished: false,
      release: undefined as (() => void) | undefined
    }
    ;(globalThis as typeof globalThis & { __hronautClosingAddressNavigation?: typeof control })
      .__hronautClosingAddressNavigation = control
    Object.defineProperty(page, 'loadURL', {
      configurable: true,
      value: async () => {
        control.started = true
        await new Promise<void>((resolve) => { control.release = resolve })
        control.finished = true
        throw new TypeError('Object has been destroyed')
      }
    })
  }, targetUrl)

  try {
    await appWindow.evaluate(({ address, tabId }) => {
      const browser = (window as unknown as { hronaut: HronautApi }).hronaut
      const pending = browser.navigate({ url: address, tabId }).then(
        (state) => ({ error: null, state }),
        async (error) => ({
          error: error instanceof Error ? error.message : String(error),
          state: await browser.getState()
        })
      )
      ;(globalThis as typeof globalThis & {
        __hronautPendingClosingAddressNavigation?: typeof pending
      }).__hronautPendingClosingAddressNavigation = pending
    }, {
      address: 'https://example.invalid/closed-during-navigation',
      tabId: targetTabId
    })
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautClosingAddressNavigation?: { started: boolean } })
        .__hronautClosingAddressNavigation?.started ?? false
    ))).toBe(true)

    const closedState = await appWindow.evaluate((tabId) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.closeTab(tabId), targetTabId)
    expect(closedState.activeTabId).toBe(fallbackTabId)
    expect(closedState.tabs.some((tab) => tab.id === targetTabId)).toBe(false)
    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __hronautClosingAddressNavigation?: { release?: () => void }
      }).__hronautClosingAddressNavigation
      if (!control?.release) throw new Error('Closing address navigation was not waiting')
      control.release()
    })

    const navigationResult = await appWindow.evaluate(async () => {
      const pending = (globalThis as typeof globalThis & {
        __hronautPendingClosingAddressNavigation?: Promise<{
          error: string | null
          state: BrowserState
        }>
      }).__hronautPendingClosingAddressNavigation
      if (!pending) throw new Error('Pending closing address navigation was not found')
      return pending
    })
    expect(navigationResult.error).toBeNull()
    expect(navigationResult.state.activeTabId).toBe(fallbackTabId)
    expect(navigationResult.state.tabs.some((tab) => tab.id === targetTabId)).toBe(false)
  } finally {
    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __hronautClosingAddressNavigation?: { release?: () => void }
      }).__hronautClosingAddressNavigation
      control?.release?.()
      delete (globalThis as typeof globalThis & { __hronautClosingAddressNavigation?: unknown })
        .__hronautClosingAddressNavigation
    })
    await appWindow.evaluate(() => {
      delete (globalThis as typeof globalThis & { __hronautPendingClosingAddressNavigation?: unknown })
        .__hronautPendingClosingAddressNavigation
    })
  }
})

test('recovers a crashed website renderer in a fresh process', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Crash recovery fixture</title><main>Renderer recovered</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Crash recovery fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/crash-recovery`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Crash recovery fixture')
    const firstProcessId = await electronApp.evaluate(({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Crash recovery web contents was not found')
      const processId = page.getOSProcessId()
      if (processId <= 0) throw new Error('Crash recovery renderer did not expose an OS process')
      process.kill(processId, 'SIGKILL')
      return processId
    }, url)

    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.pageProblem)')).toMatchObject({
      kind: 'renderer-gone',
      title: 'This page stopped working',
      url
    })
    const recovery = appWindow.getByRole('alert')
    await expect(recovery).toContainText(/The page process (crashed|was terminated)\./)
    await recovery.getByRole('button', { name: 'Try again' }).click()
    const recoveredShellState = async (): Promise<{ pageProblem: unknown; title?: string }> => {
      // Killing a child renderer can briefly invalidate Playwright's cached
      // target handle even though the BrowserWindow renderer remains healthy.
      // Reacquire the shell page so the assertion observes Hronaut recovery,
      // while a genuinely crashed shell still times out and fails the test.
      const shell = await electronApp.firstWindow()
      return shell.evaluate(`window.hronaut.getState().then((state) => {
        const active = state.tabs.find((tab) => tab.active)
        return { pageProblem: active?.pageProblem ?? null, title: active?.title }
      })`)
    }
    await expect.poll(async () => (await recoveredShellState()).pageProblem).toBeNull()
    await expect.poll(async () => (await recoveredShellState()).title).toBe('Crash recovery fixture')
    const recoveredProcessId = await electronApp.evaluate(({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.getOSProcessId()
    }, url)
    expect(recoveredProcessId).toBeTruthy()
    expect(recoveredProcessId).not.toBe(firstProcessId)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('cancels a pending wallet approval as soon as its website renderer is destroyed', async ({
  appWindow,
  electronApp
}, testInfo) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Wallet teardown fixture</title><main>Wallet teardown fixture</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Wallet teardown fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/wallet-teardown`
    const created = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`) as BrowserState
    const tab = created.tabs.find((entry) => entry.url === url)
    if (!tab?.mcpGroupId) throw new Error('Wallet teardown tab did not expose a workspace')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((entry) => entry.active)?.title)'))
      .toBe('Wallet teardown fixture')

    const vaultStatus = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
    if (vaultStatus.managedWallets === 'passphrase-setup-required') {
      await appWindow.evaluate(`window.hronautWallets.setupPassphrase('wallet teardown integration passphrase')`)
    }
    const prepared = await appWindow.evaluate(`window.hronautWallets.prepareImport(
      'evm',
      'private-key',
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    )`) as { token: string; publicAddress: string }
    await appWindow.evaluate(`window.hronautWallets.confirmImport(${JSON.stringify(prepared.token)}, {
      name: 'Renderer teardown wallet',
      network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl: 'http://127.0.0.1:8545' },
      workspaceIds: [${JSON.stringify(tab.mcpGroupId)}],
      dedicatedAgent: false
    })`)

    await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Wallet teardown WebContents was not found')
      await page.executeJavaScript(`
        window.__walletConnectState = 'waiting-provider';
        window.addEventListener('eip6963:announceProvider', (event) => {
          if (window.__walletConnectState !== 'waiting-provider' || event.detail?.info?.rdns !== 'dev.hronaut.wallet') return;
          window.__walletConnectState = 'pending';
          void event.detail.provider.request({ method: 'eth_requestAccounts' }).then(
            () => { window.__walletConnectState = 'resolved' },
            (error) => { window.__walletConnectState = 'rejected:' + error.message }
          );
        });
        window.dispatchEvent(new Event('eip6963:requestProvider'));
        'started';
      `)
    }, url)
    await expect.poll(async () => {
      const requests = await appWindow.evaluate('window.hronautWallets.listRequests()') as Array<{ id: string; operation: string; status: string }>
      return requests.find((request) => request.operation === 'connect-account' && request.status === 'awaiting-human')
    }).not.toBeUndefined()
    const approval = appWindow.getByRole('alertdialog', { name: /Connect account/i })
    await expect(approval).toBeVisible()
    await expect(approval.getByRole('button', { name: 'Approve exact request' })).toBeVisible()
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow, WebContentsView }, requestedUrl) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
      const pageView = window?.contentView.children.find((view) => (
        view instanceof WebContentsView
        && !view.webContents.isDestroyed()
        && view.webContents.getURL() === requestedUrl
      ))
      if (!(pageView instanceof WebContentsView)) throw new Error('Wallet teardown WebContentsView was not found')
      return pageView.getVisible()
    }, url)).toBe(false)
    await appWindow.screenshot({ path: testInfo.outputPath('wallet-provider-approval-without-resize.png') })
    await approval.getByRole('button', { name: 'Approve exact request' }).click()
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript('window.__walletConnectState')
    }, url)).toBe('resolved')
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow, WebContentsView }, requestedUrl) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
      const pageView = window?.contentView.children.find((view) => (
        view instanceof WebContentsView
        && !view.webContents.isDestroyed()
        && view.webContents.getURL() === requestedUrl
      ))
      return pageView instanceof WebContentsView && pageView.getVisible()
    }, url)).toBe(true)

    await electronApp.evaluate(async ({ webContents }, input) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === input.url)
      if (!page) throw new Error('Wallet teardown WebContents was not found')
      await page.executeJavaScript(`
        window.__walletSignState = 'pending';
        void window.ethereum.request({
          method: 'personal_sign',
          params: ['renderer-destroyed', ${JSON.stringify(input.publicAddress)}]
        }).then(
          () => { window.__walletSignState = 'resolved' },
          (error) => { window.__walletSignState = 'rejected:' + error.message }
        );
        'started';
      `)
    }, { url, publicAddress: prepared.publicAddress })
    await expect.poll(async () => {
      const requests = await appWindow.evaluate('window.hronautWallets.listRequests()') as Array<{ operation: string; status: string }>
      return requests.some((request) => request.operation === 'sign-message' && request.status === 'awaiting-human')
    }).toBe(true)
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow, WebContentsView }, requestedUrl) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
      const pageView = window?.contentView.children.find((view) => (
        view instanceof WebContentsView
        && !view.webContents.isDestroyed()
        && view.webContents.getURL() === requestedUrl
      ))
      return pageView instanceof WebContentsView && pageView.getVisible()
    }, url)).toBe(false)

    await electronApp.evaluate(({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Wallet teardown WebContents was not found')
      page.close()
    }, url)

    await expect.poll(async () => {
      const requests = await appWindow.evaluate('window.hronautWallets.listRequests()') as Array<{ operation: string; status: string }>
      return requests.find((request) => request.operation === 'sign-message')?.status
    }).toBe('cancelled')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('publishes legacy Solana connection state after trusted account approval', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Solana wallet fixture</title><main>Solana wallet fixture</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Solana wallet fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/solana-wallet`
    const created = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`) as BrowserState
    const tab = created.tabs.find((entry) => entry.url === url)
    if (!tab?.mcpGroupId) throw new Error('Solana wallet tab did not expose a workspace')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((entry) => entry.active)?.title)'))
      .toBe('Solana wallet fixture')

    const vaultStatus = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
    if (vaultStatus.managedWallets === 'passphrase-setup-required') {
      await appWindow.evaluate(`window.hronautWallets.setupPassphrase('solana provider integration passphrase')`)
    }
    const prepared = await appWindow.evaluate(`window.hronautWallets.prepareImport(
      'solana',
      'mnemonic',
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    )`) as { token: string; publicAddress: string }
    await appWindow.evaluate(`window.hronautWallets.confirmImport(${JSON.stringify(prepared.token)}, {
      name: 'Solana provider account',
      network: { id: 'devnet', name: 'Solana Devnet', environment: 'testnet', rpcUrl: 'https://api.devnet.solana.com' },
      workspaceIds: [${JSON.stringify(tab.mcpGroupId)}],
      dedicatedAgent: false
    })`)

    await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Solana wallet WebContents was not found')
      await page.executeJavaScript(`
        window.__legacySolanaConnection = { phase: 'pending' };
        void window.hronautSolana.connect().then(
          ({ publicKey }) => {
            window.__legacySolanaConnection = {
              phase: 'connected',
              returnedAddress: publicKey.toBase58(),
              providerAddress: window.hronautSolana.publicKey?.toString(),
              publicKeyBytes: Array.from(publicKey.toBytes()),
              isConnected: window.hronautSolana.isConnected
            };
          },
          (error) => { window.__legacySolanaConnection = { phase: 'rejected', message: error.message } }
        );
        'started';
      `)
    }, url)

    await expect.poll(async () => {
      const requests = await appWindow.evaluate('window.hronautWallets.listRequests()') as Array<{ operation: string; status: string }>
      return requests.some((request) => request.operation === 'connect-account' && request.status === 'awaiting-human')
    }).toBe(true)
    const approval = appWindow.getByRole('alertdialog', { name: /Connect account/i })
    await expect(approval).toBeVisible()
    await approval.getByRole('button', { name: 'Approve exact request' }).click()

    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript('window.__legacySolanaConnection')
    }, url)).toMatchObject({
      phase: 'connected',
      returnedAddress: prepared.publicAddress,
      providerAddress: prepared.publicAddress,
      isConnected: true
    })

    const publicKeyLength = await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript('window.__legacySolanaConnection.publicKeyBytes.length')
    }, url)
    expect(publicKeyLength).toBe(32)
  } finally {
    await closeFixtureServer(server)
  }
})

test('keeps shell state usable when Electron destroys a tab WebContents independently', async ({
  appWindow,
  electronApp
}) => {
  const url = 'data:text/html,<title>Native teardown fixture</title><main>Native teardown fixture</main>'
  const created = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`) as BrowserState
  const tabId = created.activeTabId
  const homeTabId = created.tabs.find((tab) => tab.url.startsWith('hronaut://home'))?.id
  expect(tabId).toBeTruthy()
  expect(homeTabId).toBeTruthy()
  await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(homeTabId)})`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'))
    .toBe('Native teardown fixture')
  await expect.poll(() => electronApp.evaluate(({ webContents }, requestedUrl) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
    return page?.debugger.isAttached() ?? false
  }, url)).toBe(true)

  await electronApp.evaluate(({ webContents }, requestedUrl) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
    if (!page) throw new Error('Native teardown fixture WebContents was not found')
    page.close()
  }, url)

  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
    active: state.tabs.find((tab) => tab.active),
    stale: state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})
  }))`)).toMatchObject({
    active: {
      url: 'about:blank'
    },
    stale: {
      devToolsOpen: false,
      pageProblem: {
        kind: 'renderer-gone',
        title: 'This page is no longer available'
      }
    }
  })
  await appWindow.getByRole('tab', { name: /Native teardown fixture/ }).click()
  await expect(appWindow.getByRole('alert', { name: 'Open tab failed' })).toContainText(
    'tab renderer is no longer available'
  )
  await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(tabId)})`)
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
    state.tabs.some((tab) => tab.id === ${JSON.stringify(tabId)})
  ))`)).toBe(false)

  const recovery = await appWindow.evaluate(`window.hronaut.newTab({ url: 'about:blank', active: true })`) as BrowserState
  expect(recovery.tabs.some((tab) => tab.id === recovery.activeTabId)).toBe(true)
})

test('puts Help in the native application menu and opens shell dialogs above every page', async ({ appWindow, electronApp }) => {
  const menuItems = await electronApp.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    return Object.fromEntries((menu?.items ?? []).map((item) => [
      item.label,
      item.submenu?.items.map((child) => child.type === 'separator' ? 'separator' : child.label) ?? []
    ]))
  })
  expect(menuItems.Help).toEqual([
    'Keyboard Shortcuts',
    'About Hronaut',
    'Commercial License',
    'separator',
    'GitHub Repository',
    'Check for Updates'
  ])
  expect(menuItems.View).toEqual([
    'Command Palette…',
    'Pick Element for Agent',
    'separator',
    'Reload Tab',
    'Reload Tab Without Cache',
    'Developer Tools',
    'separator',
    'Actual Size',
    'Zoom In',
    'Zoom Out',
    'Toggle Full Screen'
  ])
  await expect(appWindow.getByRole('button', { name: 'Help', exact: true })).toHaveCount(0)
  expect(await appWindow.evaluate('window.hronaut.toggleDevTools()')).toBe(false)

  const clickMenuItem = (menuLabel: string, itemLabel: string): Promise<void> => electronApp.evaluate(
    ({ BrowserWindow, Menu }, labels) => {
      const menu = Menu.getApplicationMenu()?.items.find((item) => item.label === labels.menuLabel)
      const item = menu?.submenu?.items.find((candidate) => candidate.label === labels.itemLabel)
      if (!item?.click) throw new Error(`Missing menu item: ${labels.menuLabel} → ${labels.itemLabel}`)
      item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
    },
    { menuLabel, itemLabel }
  )

  const commandButton = appWindow.getByRole('button', { name: 'Open command palette' })
  await commandButton.click()
  const commandPalette = appWindow.getByRole('dialog', { name: 'Commands' })
  await expect(commandPalette).toBeVisible()
  await clickMenuItem('Help', 'Keyboard Shortcuts')
  await expect(commandPalette).toBeHidden()
  const shortcutsDialog = appWindow.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(shortcutsDialog).toBeVisible()
  await expect(shortcutsDialog).toContainText('Focus the address bar')
  await expect(shortcutsDialog).toContainText('Reload without cached files')
  await expect(shortcutsDialog).toContainText('Clear browsing data')
  await expect(shortcutsDialog).toContainText('Pick an element for agent context')
  await expect(shortcutsDialog).toContainText('Toggle developer tools')
  await appWindow.keyboard.press('Escape')
  await expect(shortcutsDialog).toBeHidden()
  await expect(commandButton).toBeFocused()

  await clickMenuItem('Help', 'About Hronaut')
  const aboutDialog = appWindow.getByRole('dialog', { name: 'About Hronaut' })
  await expect(aboutDialog).toBeVisible()
  await expect(aboutDialog).toContainText('A persistent, visible browser')
  await expect(aboutDialog.getByRole('button', { name: 'PolyForm Noncommercial license' })).toBeVisible()
  await expect(aboutDialog.getByRole('button', { name: 'Contribute' })).toBeVisible()
  await aboutDialog.getByRole('button', { name: 'Commercial license', exact: true }).click()
  await expect(aboutDialog).toBeHidden()
  await expect(appWindow.locator('.settings-dialog')).toContainText('Commercial license')
  await appWindow.locator('.settings-dialog').getByRole('button', { name: 'Close', exact: true }).click()

  await clickMenuItem('Help', 'Commercial License')
  await expect(appWindow.locator('.settings-dialog')).toContainText('Commercial license')
  await appWindow.locator('.settings-dialog').getByRole('button', { name: 'Close', exact: true }).click()

  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await expect(appWindow.locator('.toolbar')).toBeVisible()
  await clickMenuItem('View', 'Pick Element for Agent')
  await expect(appWindow.getByRole('button', { name: 'Cancel element selection' })).toBeVisible()
  await clickMenuItem('View', 'Pick Element for Agent')
  await expect(appWindow.getByRole('button', { name: 'Select an element to copy for agent' })).toBeVisible()
  await clickMenuItem('View', 'Developer Tools')
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.devToolsOpen)')).toBe(true)
  await clickMenuItem('View', 'Developer Tools')
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.devToolsOpen)')).toBe(false)

  await clickMenuItem('Help', 'GitHub Repository')
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.url)')).toBe('https://github.com/hronaut/hronaut')
})

test('reports a failed About link without leaving the shell in an unhandled state', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ BrowserWindow, Menu, ipcMain }) => {
    ipcMain.removeHandler('browser:new-tab')
    ipcMain.handle('browser:new-tab', () => {
      throw new Error('Help link navigation unavailable for regression test')
    })
    const help = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Help')
    const about = help?.submenu?.items.find((item) => item.label === 'About Hronaut')
    if (!about?.click) throw new Error('About Hronaut menu item was not found')
    about.click(about, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
  })

  const aboutDialog = appWindow.getByRole('dialog', { name: 'About Hronaut' })
  await expect(aboutDialog).toBeVisible()
  await aboutDialog.getByRole('button', { name: 'GitHub repository' }).click()

  await expect(aboutDialog).toBeHidden()
  await expect(appWindow.getByRole('alert', { name: 'Browser action failed' })).toContainText(
    'Help link navigation unavailable for regression test'
  )
  await expect(appWindow.getByRole('button', { name: 'Settings' })).toBeEnabled()
})

test('reloads the active website from View and bypasses cached subresources on demand', async ({ appWindow, electronApp }) => {
  let scriptRequests = 0
  const server = createServer((request, response) => {
    if (request.url === '/version.js') {
      scriptRequests += 1
      response.writeHead(200, {
        'content-type': 'application/javascript',
        'cache-control': 'public, max-age=3600'
      })
      response.end(`window.cachedReloadVersion = ${scriptRequests}`)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end(`<!doctype html><title>Loading reload fixture</title><script src="/version.js"></script><script>
      const loads = Number(sessionStorage.getItem('reload-loads') || 0) + 1
      sessionStorage.setItem('reload-loads', String(loads))
      document.title = 'Reload ' + window.cachedReloadVersion + ' / ' + loads
    </script>`)
  })
  const address = await new Promise<{ port: number }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address() as { port: number }))
  })
  const url = `http://127.0.0.1:${address.port}/`
  const activeTitle = (): Promise<string | undefined> => appWindow.evaluate(
    'window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'
  )
  const clickViewItem = (label: string): Promise<void> => electronApp.evaluate(({ BrowserWindow, Menu }, itemLabel) => {
    const item = Menu.getApplicationMenu()?.items.find((candidate) => candidate.label === 'View')
      ?.submenu?.items.find((candidate) => candidate.label === itemLabel)
    if (!item?.click) throw new Error(`Missing View menu item: ${itemLabel}`)
    item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
  }, label)

  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(activeTitle).toBe('Reload 1 / 1')

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' })
      .getByRole('button', { name: 'Open network monitor' })
      .click()
    const networkPanel = appWindow.getByRole('dialog', { name: 'Network' })
    await expect(networkPanel).toBeVisible()

    await clickViewItem('Reload Tab')
    await expect(networkPanel).toBeHidden()
    await expect.poll(activeTitle).toBe('Reload 1 / 2')
    expect(scriptRequests).toBe(1)

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' })
      .getByRole('button', { name: 'Open network monitor' })
      .click()
    await expect(networkPanel).toBeVisible()
    await clickViewItem('Reload Tab Without Cache')
    await expect(networkPanel).toBeHidden()
    await expect.poll(activeTitle).toBe('Reload 2 / 3')
    expect(scriptRequests).toBe(2)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('reports rejected native application-menu actions without an unhandled main-process rejection', async ({
  appWindow,
  electronApp
}) => {
  const url = 'data:text/html,<title>Native menu failure fixture</title><main>Menu failure</main>'
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Native menu failure fixture')

  await electronApp.evaluate(({ webContents }, requestedUrl) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
    if (!page) throw new Error('Native menu failure fixture was not found')
    Object.defineProperty(page, 'reload', {
      configurable: true,
      value: () => { throw new Error('Native menu reload unavailable for regression test') }
    })
    const mainGlobal = globalThis as typeof globalThis & {
      __hronautUnhandledMenuRejection?: string | null
      __hronautUnhandledMenuRejectionListener?: (reason: unknown) => void
    }
    mainGlobal.__hronautUnhandledMenuRejection = null
    mainGlobal.__hronautUnhandledMenuRejectionListener = (reason) => {
      ;(globalThis as typeof globalThis & { __hronautUnhandledMenuRejection?: string | null })
        .__hronautUnhandledMenuRejection = reason instanceof Error ? reason.message : String(reason)
    }
    process.once('unhandledRejection', mainGlobal.__hronautUnhandledMenuRejectionListener)
  }, url)
  await electronApp.evaluate(({ BrowserWindow, Menu }) => {
    const item = Menu.getApplicationMenu()?.items.find((candidate) => candidate.label === 'View')
      ?.submenu?.items.find((candidate) => candidate.label === 'Reload Tab')
    if (!item?.click) throw new Error('Reload Tab application-menu action was not found')
    item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
  })

  const failure = appWindow.getByRole('alert', { name: 'Reload failed' })
  await expect(failure).toContainText('Native menu reload unavailable for regression test')
  expect(await electronApp.evaluate(() => {
    const mainGlobal = globalThis as typeof globalThis & {
      __hronautUnhandledMenuRejection?: string | null
      __hronautUnhandledMenuRejectionListener?: (reason: unknown) => void
    }
    const rejection = mainGlobal.__hronautUnhandledMenuRejection
    if (mainGlobal.__hronautUnhandledMenuRejectionListener) {
      process.off('unhandledRejection', mainGlobal.__hronautUnhandledMenuRejectionListener)
    }
    delete mainGlobal.__hronautUnhandledMenuRejection
    delete mainGlobal.__hronautUnhandledMenuRejectionListener
    return rejection
  })).toBeNull()
  await expect(appWindow.getByRole('button', { name: 'Settings' })).toBeEnabled()
})

test('reports a failed native repository tab without leaving the menu action silent', async ({
  appWindow,
  electronApp
}) => {
  // Wait until startup has created its initial native page view so the
  // one-shot prototype failure below can only target the menu-created tab.
  await expect.poll(() => appWindow.evaluate(
    'window.hronaut.getState().then((state) => state.tabs.length)'
  )).toBeGreaterThan(0)
  await electronApp.evaluate(({ WebContentsView }) => {
    const prototype = WebContentsView.prototype
    const originalSetBackgroundColor = prototype.setBackgroundColor
    Object.defineProperty(prototype, 'setBackgroundColor', {
      configurable: true,
      value(this: Electron.WebContentsView, color: string) {
        // The address-suggestion overlay may finish initializing after the
        // shell reaches domcontentloaded. Do not let that transparent helper
        // view consume the browser-tab failure injected by this test.
        if (color !== '#ffffff') return originalSetBackgroundColor.call(this, color)
        Object.defineProperty(prototype, 'setBackgroundColor', {
          configurable: true,
          value: originalSetBackgroundColor,
          writable: true
        })
        throw new Error('Repository tab unavailable for regression test')
      },
      writable: true
    })
  })
  await electronApp.evaluate(({ BrowserWindow, Menu }) => {
    const item = Menu.getApplicationMenu()?.items.find((candidate) => candidate.label === 'Help')
      ?.submenu?.items.find((candidate) => candidate.label === 'GitHub Repository')
    if (!item?.click) throw new Error('GitHub Repository application-menu action was not found')
    item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
  })

  await expect(appWindow.getByRole('alert', { name: 'Browser action failed' })).toContainText(
    'Repository tab unavailable for regression test'
  )
  await expect(appWindow.getByRole('button', { name: 'Settings' })).toBeEnabled()
})

test('keeps MCP pause changes handled when the Home refresh fails', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate('window.hronaut.openHome()')
  await expect.poll(() => electronApp.evaluate(({ webContents }) => (
    webContents.getAllWebContents().some((contents) => contents.getURL().startsWith('hronaut://home'))
  ))).toBe(true)
  await electronApp.evaluate(({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    const originalReload = home.reload.bind(home)
    let failNextReload = true
    Object.defineProperty(home, 'reload', {
      configurable: true,
      value: () => {
        if (failNextReload) {
          failNextReload = false
          throw new Error('Home refresh unavailable for regression test')
        }
        return originalReload()
      }
    })
    const mainGlobal = globalThis as typeof globalThis & {
      __hronautUnhandledHomeRefreshRejection?: string | null
      __hronautUnhandledHomeRefreshRejectionListener?: (reason: unknown) => void
    }
    mainGlobal.__hronautUnhandledHomeRefreshRejection = null
    mainGlobal.__hronautUnhandledHomeRefreshRejectionListener = (reason) => {
      ;(globalThis as typeof globalThis & { __hronautUnhandledHomeRefreshRejection?: string | null })
        .__hronautUnhandledHomeRefreshRejection = reason instanceof Error ? reason.message : String(reason)
    }
    process.once('unhandledRejection', mainGlobal.__hronautUnhandledHomeRefreshRejectionListener)
  })

  await appWindow.evaluate('window.hronautMcp.setPaused(true)')
  await appWindow.waitForTimeout(100)

  expect(await electronApp.evaluate(() => {
    const mainGlobal = globalThis as typeof globalThis & {
      __hronautUnhandledHomeRefreshRejection?: string | null
      __hronautUnhandledHomeRefreshRejectionListener?: (reason: unknown) => void
    }
    const rejection = mainGlobal.__hronautUnhandledHomeRefreshRejection
    if (mainGlobal.__hronautUnhandledHomeRefreshRejectionListener) {
      process.off('unhandledRejection', mainGlobal.__hronautUnhandledHomeRefreshRejectionListener)
    }
    delete mainGlobal.__hronautUnhandledHomeRefreshRejection
    delete mainGlobal.__hronautUnhandledHomeRefreshRejectionListener
    return rejection
  })).toBeNull()

  await appWindow.evaluate('window.hronautMcp.setPaused(false)')
})

test('supports standard tab and address shortcuts from the shell and websites', async ({ appWindow, electronApp }) => {
  const primary = process.platform === 'darwin' ? 'Meta' : 'Control'
  const address = appWindow.getByRole('combobox', { name: 'Address' })
  const homeButton = appWindow.getByRole('button', { name: 'Open Hronaut Home' })

  await expect(homeButton).toHaveAttribute('aria-current', 'page')
  await homeButton.focus()
  await appWindow.keyboard.press(`${primary}+L`)
  await expect(address).toBeFocused()
  await expect(appWindow.getByRole('tab')).toHaveCount(1)

  await appWindow.keyboard.press(`${primary}+T`)
  await expect(appWindow.getByRole('tab')).toHaveCount(2)
  await expect(address).toBeFocused()

  const fixtureUrl = 'data:text/html,<title>Shortcut fixture</title><main>Recovered tab</main>'
  await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(fixtureUrl)} })`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Shortcut fixture')

  await appWindow.keyboard.press(`${primary}+T`)
  await expect(appWindow.getByRole('tab')).toHaveCount(3)
  await appWindow.keyboard.press(`${primary}+2`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Shortcut fixture')
  await appWindow.keyboard.press(`${primary}+9`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.url)')).toBe('about:blank')
  await expect(homeButton).not.toHaveAttribute('aria-current', 'page')
  await appWindow.keyboard.press('Control+Shift+Tab')
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Shortcut fixture')
  await appWindow.keyboard.press('Control+Tab')
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.url)')).toBe('about:blank')

  const rapidCycleTargetId = await appWindow.evaluate(`window.hronaut.getState().then((state) => {
    const currentIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId)
    return state.tabs[(currentIndex + 2) % state.tabs.length]?.id
  })`) as string
  await appWindow.evaluate(() => {
    const shortcut = { key: 'Tab', code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true }
    window.dispatchEvent(new KeyboardEvent('keydown', shortcut))
    window.dispatchEvent(new KeyboardEvent('keydown', shortcut))
  })
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(rapidCycleTargetId)

  await appWindow.keyboard.press(`${primary}+W`)
  await expect(appWindow.getByRole('tab')).toHaveCount(2)
  await appWindow.keyboard.press(`${primary}+W`)
  await expect(appWindow.getByRole('tab')).toHaveCount(1)
  await appWindow.keyboard.press(`${primary}+Shift+T`)
  await expect(appWindow.getByRole('tab')).toHaveCount(2)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Shortcut fixture')

  const reopenedUrl = await appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.url)') as string
  await electronApp.evaluate(({ webContents }, requestedUrl) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
    if (!page) throw new Error('Shortcut fixture web contents was not found')
    page.focus()
    const modifiers = process.platform === 'darwin' ? ['meta'] as const : ['control'] as const
    page.sendInputEvent({ type: 'keyDown', keyCode: 'L', modifiers: [...modifiers] })
    page.sendInputEvent({ type: 'keyUp', keyCode: 'L', modifiers: [...modifiers] })
  }, reopenedUrl)
  await expect(address).toBeFocused()

  await electronApp.evaluate(({ webContents }, requestedUrl) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
    if (!page) throw new Error('Shortcut fixture web contents was not found')
    page.focus()
    const modifiers = process.platform === 'darwin' ? ['meta'] as const : ['control'] as const
    page.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: [...modifiers] })
    page.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: [...modifiers] })
  }, reopenedUrl)
  await expect(appWindow.getByRole('tab')).toHaveCount(3)
})

test('does not steal address focus when delayed new-tab creation loses to a newer selection', async ({
  appWindow,
  electronApp
}) => {
  const newerUrl = 'data:text/html,<title>Newer focus choice</title><main>Keep this tab selected</main>'
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(newerUrl)}, active: false })`)
  const newerTab = appWindow.getByRole('tab', { name: /^Newer focus choice/ })
  await expect(newerTab).toBeVisible()

  await electronApp.evaluate(({ ipcMain }) => {
    type InvokeHandler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, InvokeHandler> })._invokeHandlers
    const original = handlers.get('browser:new-tab')
    if (!original) throw new Error('New-tab IPC handler was not registered')
    const control = {
      original,
      started: false,
      returned: false,
      release: undefined as (() => void) | undefined
    }
    ;(globalThis as typeof globalThis & { __hronautDelayedNewTab?: typeof control }).__hronautDelayedNewTab = control
    ipcMain.removeHandler('browser:new-tab')
    ipcMain.handle('browser:new-tab', async (event, ...args) => {
      const result = await original(event, ...args)
      control.started = true
      await new Promise<void>((resolve) => { control.release = resolve })
      control.returned = true
      return result
    })
  })

  try {
    await appWindow.getByRole('button', { name: 'Settings' }).focus()
    await appWindow.keyboard.press(`${primaryModifier}+T`)
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautDelayedNewTab?: { started: boolean } })
        .__hronautDelayedNewTab?.started ?? false
    ))).toBe(true)

    await newerTab.click()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Newer focus choice')

    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __hronautDelayedNewTab?: { release?: () => void }
      }).__hronautDelayedNewTab
      if (!control?.release) throw new Error('Delayed new-tab response was not waiting')
      control.release()
    })
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautDelayedNewTab?: { returned: boolean } })
        .__hronautDelayedNewTab?.returned ?? false
    ))).toBe(true)
    await appWindow.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')

    await expect(appWindow.getByRole('combobox', { name: 'Address' })).not.toBeFocused()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Newer focus choice')
  } finally {
    await electronApp.evaluate(({ ipcMain }) => {
      const mainGlobal = globalThis as typeof globalThis & {
        __hronautDelayedNewTab?: {
          original: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
          release?: () => void
        }
      }
      const control = mainGlobal.__hronautDelayedNewTab
      if (!control) return
      control.release?.()
      ipcMain.removeHandler('browser:new-tab')
      ipcMain.handle('browser:new-tab', control.original)
      delete mainGlobal.__hronautDelayedNewTab
    }).catch(() => undefined)
  }
})

test('reports a rejected browser shortcut without breaking the shell', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('browser:reload')
    ipcMain.handle('browser:reload', () => {
      throw new Error('Reload channel unavailable for regression test')
    })
  })

  await appWindow.getByRole('button', { name: 'Settings' }).focus()
  await appWindow.keyboard.press(`${primaryModifier}+R`)

  const failure = appWindow.getByRole('alert', { name: 'Browser action failed' })
  await expect(failure).toContainText('Reload channel unavailable for regression test')
  await expect(appWindow.getByRole('button', { name: 'Settings' })).toBeEnabled()
  await expect(appWindow.getByRole('button', { name: 'Open Hronaut Home' })).toHaveAttribute('aria-current', 'page')
})

test('reports rejected shell controls without an unhandled renderer rejection', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(() => {
    type RejectionEvent = { reason: unknown; preventDefault: () => void }
    const shellWindow = globalThis as typeof globalThis & {
      __hronautUnhandledTopbarRejection?: string | null
      __hronautUnhandledTopbarRejectionListener?: (event: RejectionEvent) => void
      addEventListener: (type: string, listener: (event: RejectionEvent) => void) => void
    }
    shellWindow.__hronautUnhandledTopbarRejection = null
    shellWindow.__hronautUnhandledTopbarRejectionListener = (event) => {
      shellWindow.__hronautUnhandledTopbarRejection = event.reason instanceof Error
        ? event.reason.message
        : String(event.reason)
      event.preventDefault()
    }
    shellWindow.addEventListener('unhandledrejection', shellWindow.__hronautUnhandledTopbarRejectionListener)
  })
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('downloads:list')
    ipcMain.handle('downloads:list', () => {
      throw new Error('Downloads channel unavailable for regression test')
    })
  })

  await appWindow.getByRole('button', { name: 'Downloads', exact: true }).click()

  const topbarFailure = appWindow.getByRole('alert', { name: 'Browser action failed' })
    .filter({ hasText: 'Downloads channel unavailable for regression test' })
  await expect(topbarFailure).toBeVisible()
  await expect(appWindow.getByRole('dialog', { name: 'Downloads' })).toBeHidden()

  await appWindow.evaluate('window.hronaut.newTab({ active: true })')
  const reload = appWindow.locator('.toolbar').getByRole('button', { name: 'Reload', exact: true })
  await expect(reload).toBeVisible()
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('browser:reload')
    ipcMain.handle('browser:reload', () => {
      throw new Error('Toolbar reload unavailable for regression test')
    })
  })

  await reload.click()

  const toolbarFailure = appWindow.getByRole('alert', { name: 'Browser action failed' })
    .filter({ hasText: 'Toolbar reload unavailable for regression test' })
  await expect(toolbarFailure).toBeVisible()

  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('browser:save-pdf')
    ipcMain.handle('browser:save-pdf', () => {
      throw new Error('PDF download directory is read-only for regression test')
    })
  })
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
  await expect(pageTools).toBeVisible()
  await pageTools.getByRole('button', { name: 'Save page as PDF', exact: true }).click()
  await expect(pageTools).toBeHidden()
  const pdfFailure = appWindow.getByRole('alert', { name: 'Could not save page as PDF' })
  await expect(pdfFailure).toContainText('PDF download directory is read-only for regression test')

  expect(await appWindow.evaluate(() => {
    type RejectionEvent = { reason: unknown; preventDefault: () => void }
    const shellWindow = globalThis as typeof globalThis & {
      __hronautUnhandledTopbarRejection?: string | null
      __hronautUnhandledTopbarRejectionListener?: (event: RejectionEvent) => void
      removeEventListener: (type: string, listener: (event: RejectionEvent) => void) => void
    }
    const rejection = shellWindow.__hronautUnhandledTopbarRejection
    if (shellWindow.__hronautUnhandledTopbarRejectionListener) {
      shellWindow.removeEventListener('unhandledrejection', shellWindow.__hronautUnhandledTopbarRejectionListener)
    }
    delete shellWindow.__hronautUnhandledTopbarRejection
    delete shellWindow.__hronautUnhandledTopbarRejectionListener
    return rejection
  })).toBeNull()
  await expect(appWindow.getByRole('button', { name: 'Settings' })).toBeEnabled()
})

test('keeps the newer collection panel open when a Downloads refresh finishes late', async ({
  appWindow,
  electronApp
}) => {
  await electronApp.evaluate(({ ipcMain }) => {
    const mainGlobal = globalThis as typeof globalThis & { __resolveDelayedDownloads?: () => void }
    ipcMain.removeHandler('downloads:list')
    ipcMain.handle('downloads:list', () => new Promise<[]>(resolve => {
      mainGlobal.__resolveDelayedDownloads = () => resolve([])
    }))
  })

  const downloadsPanel = appWindow.getByRole('dialog', { name: 'Downloads' })
  const historyPanel = appWindow.getByRole('dialog', { name: 'Browsing history' })
  await appWindow.getByRole('button', { name: 'Downloads', exact: true }).click()
  await expect(downloadsPanel).toBeVisible()

  await appWindow.getByRole('button', { name: 'Browsing history' }).click()
  await expect(historyPanel).toBeVisible()
  await expect(downloadsPanel).toBeHidden()

  await electronApp.evaluate(() => {
    const mainGlobal = globalThis as typeof globalThis & { __resolveDelayedDownloads?: () => void }
    if (!mainGlobal.__resolveDelayedDownloads) throw new Error('Delayed Downloads request did not start')
    mainGlobal.__resolveDelayedDownloads()
    delete mainGlobal.__resolveDelayedDownloads
  })

  await expect(historyPanel).toBeVisible()
  await expect(downloadsPanel).toBeHidden()
})

test('rolls back rejected diagnostic log preservation without an unhandled renderer rejection', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(() => {
    type RejectionEvent = { reason: unknown; preventDefault: () => void }
    const shellWindow = globalThis as typeof globalThis & {
      __hronautUnhandledPreservationRejection?: string | null
      __hronautUnhandledPreservationRejectionListener?: (event: RejectionEvent) => void
      addEventListener: (type: string, listener: (event: RejectionEvent) => void) => void
    }
    shellWindow.__hronautUnhandledPreservationRejection = null
    shellWindow.__hronautUnhandledPreservationRejectionListener = (event) => {
      shellWindow.__hronautUnhandledPreservationRejection = event.reason instanceof Error
        ? event.reason.message
        : String(event.reason)
      event.preventDefault()
    }
    shellWindow.addEventListener('unhandledrejection', shellWindow.__hronautUnhandledPreservationRejectionListener)
  })
  await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Preservation failure fixture</title>', active: true })`)
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: 'Open network monitor' }).click()
  const preserveToggle = appWindow.getByRole('dialog', { name: 'Network' }).getByLabel('Preserve logs')
  const originallyChecked = await preserveToggle.isChecked()

  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('browser:set-diagnostic-log-preservation')
    ipcMain.handle('browser:set-diagnostic-log-preservation', () => {
      throw new Error('Diagnostic preservation unavailable for regression test')
    })
  })
  await preserveToggle.click()

  const failure = appWindow.getByRole('alert', { name: 'Setting not saved' })
    .filter({ hasText: 'Diagnostic preservation unavailable for regression test' })
  await expect(failure).toBeVisible()
  await expect(preserveToggle).toBeChecked({ checked: originallyChecked })
  await expect(preserveToggle).toBeEnabled()
  expect(await appWindow.evaluate(() => {
    type RejectionEvent = { reason: unknown; preventDefault: () => void }
    const shellWindow = globalThis as typeof globalThis & {
      __hronautUnhandledPreservationRejection?: string | null
      __hronautUnhandledPreservationRejectionListener?: (event: RejectionEvent) => void
      removeEventListener: (type: string, listener: (event: RejectionEvent) => void) => void
    }
    const rejection = shellWindow.__hronautUnhandledPreservationRejection
    if (shellWindow.__hronautUnhandledPreservationRejectionListener) {
      shellWindow.removeEventListener('unhandledrejection', shellWindow.__hronautUnhandledPreservationRejectionListener)
    }
    delete shellWindow.__hronautUnhandledPreservationRejection
    delete shellWindow.__hronautUnhandledPreservationRejectionListener
    return rejection
  })).toBeNull()
})

test('keeps a newer browser event when a viewport response returns stale state', async ({ appWindow, electronApp }) => {
  const fixtureTitle = 'Viewport stale response fixture'
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`data:text/html,<title>${fixtureTitle}</title>`)}, active: true })`)
  await expect(appWindow.getByRole('tab', { name: new RegExp(`^${fixtureTitle}`) })).toBeVisible()
  const staleState = await appWindow.evaluate('window.hronaut.getState()') as BrowserState
  const newerState = structuredClone(staleState)
  const activeTab = newerState.tabs.find((tab) => tab.id === newerState.activeTabId)
  if (!activeTab) throw new Error('Viewport stale-response fixture did not have an active tab')
  activeTab.title = 'Newer browser event title'

  await electronApp.evaluate(({ ipcMain }, states) => {
    ipcMain.removeHandler('browser:set-tab-viewport')
    ipcMain.handle('browser:set-tab-viewport', (event) => new Promise((resolve) => {
      event.sender.send('browser:state-changed', states.newerState)
      setTimeout(() => resolve(states.staleState), 75)
    }))
  }, { staleState, newerState })

  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
  await pageTools.getByRole('button', { name: 'Responsive preview: Test phones, tablets, and desktops' }).click()
  const responsivePanel = appWindow.getByRole('dialog', { name: 'Responsive preview' })
  await responsivePanel.getByRole('button', { name: /^Tablet/ }).click()
  await responsivePanel.getByRole('button', { name: 'Apply preview' }).click()

  await expect(responsivePanel).toContainText('Viewport applied')
  await expect(appWindow.getByRole('tab', { name: /^Newer browser event title/ })).toBeVisible()
  await expect(appWindow.getByRole('tab', { name: new RegExp(`^${fixtureTitle}`) })).toHaveCount(0)
})

test('floats bookmark and history suggestions above pages while allowing duplicate addresses', async ({ appWindow, electronApp }) => {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url ?? '/')
    const title = request.url === '/bookmark' ? 'Suggestion bookmark' : 'Suggestion history'
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>${title}</title><main>${title}</main>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const serverAddress = server.address()
    if (!serverAddress || typeof serverAddress === 'string') throw new Error('Address-suggestion fixture did not expose a port')
    const historyUrl = `http://127.0.0.1:${serverAddress.port}/history`
    const bookmarkUrl = `http://127.0.0.1:${serverAddress.port}/bookmark`
    const address = appWindow.getByRole('combobox', { name: 'Address' })
    await appWindow.evaluate('window.hronaut.newTab({ active: true })')
    await address.fill(historyUrl)
    await address.press('Enter')
    await expect.poll(() => appWindow.evaluate('window.hronautHistory.list()')).toEqual([
      expect.objectContaining({ url: historyUrl, title: 'Suggestion history' })
    ])
    await appWindow.evaluate('window.hronaut.newTab({ active: true })')
    await address.fill(new URL(historyUrl).hostname)
    await expect(appWindow.locator('#address-suggestions [role="option"]')).toHaveCount(1)
    await expect(appWindow.locator('#address-suggestions [role="option"]').first()).toContainText('Suggestion history')
    await address.fill('')
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(bookmarkUrl)}, active: false })`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.url === ${JSON.stringify(bookmarkUrl)})?.title)`)).toBe('Suggestion bookmark')
    await appWindow.evaluate(`window.hronautBookmarks.add(${JSON.stringify(bookmarkUrl)}, 'Suggestion bookmark')`)

    const browserViewY = (): Promise<number | undefined> => electronApp.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows()[0]?.contentView.children[0]?.getBounds().y
    ))
    const addressOverlay = (): Promise<{
      id?: number
      attached: boolean
      topmost: boolean
      visible: boolean
      bounds?: { x: number; y: number; width: number; height: number }
      optionCount: number
      text: string
    }> => electronApp.evaluate(async ({ BrowserWindow, webContents }) => {
      const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().includes('address-overlay.html'))
      const children = main?.contentView.children ?? []
      const index = contents
        ? children.findIndex((view) => (view as unknown as { webContents?: { id: number } }).webContents?.id === contents.id)
        : -1
      const view = index >= 0 ? children[index] : undefined
      return {
        ...(contents ? { id: contents.id } : {}),
        attached: index >= 0,
        topmost: index >= 0 && index === children.length - 1,
        visible: view?.getVisible() ?? false,
        bounds: view?.getBounds(),
        optionCount: contents
          ? await contents.executeJavaScript(`document.querySelectorAll('[role="option"]').length`)
          : 0,
        text: contents ? await contents.executeJavaScript('document.body.innerText') : ''
      }
    })
    const clickOverlayOption = (index: number): Promise<void> => electronApp.evaluate(async ({ webContents }, optionIndex) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().includes('address-overlay.html'))
      if (!contents) throw new Error('Address suggestion overlay was not found')
      await contents.executeJavaScript(`document.querySelectorAll('[role="option"]')[${optionIndex}]?.click()`)
    }, index)
    const overlayScrollTop = (): Promise<number> => electronApp.evaluate(async ({ webContents }) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().includes('address-overlay.html'))
      if (!contents) return 0
      return contents.executeJavaScript(`document.querySelector('.address-suggestions')?.scrollTop ?? 0`)
    })
    const listbox = appWindow.locator('#address-suggestions')
    const options = listbox.locator('[role="option"]')
    const requestCountBeforeTyping = requests.length
    // Reproduce normal human input: focusing an empty address bar must show
    // recent local destinations immediately. The website view must never move
    // to make room for the native suggestion overlay.
    await address.focus()
    await address.fill('')
    await expect(address).toHaveAttribute('aria-expanded', 'true')
    await expect(options).toHaveCount(2)
    await expect(options.nth(0)).toContainText('History')
    await expect(options.nth(1)).toContainText('History')
    await expect.poll(addressOverlay).toMatchObject({
      attached: true,
      topmost: true,
      visible: true,
      optionCount: 2,
      text: expect.stringContaining('Local only')
    })
    const originalOverlayId = (await addressOverlay()).id
    expect(originalOverlayId).toBeDefined()
    await electronApp.evaluate(({ webContents }, contentsId) => {
      const contents = webContents.fromId(contentsId)
      if (!contents) throw new Error('Address suggestion overlay was not found for teardown')
      contents.close()
    }, originalOverlayId!)
    await expect(address).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(addressOverlay).toMatchObject({ attached: false, visible: false })
    await address.fill('')
    await address.fill('Suggestion')
    await expect.poll(addressOverlay).toMatchObject({ attached: true, topmost: true, visible: true, optionCount: 2 })
    expect((await addressOverlay()).id).not.toBe(originalOverlayId)
    await appWindow.waitForTimeout(100)
    const browserViewYWithoutPopup = await browserViewY()
    expect(browserViewYWithoutPopup).toBeDefined()
    await address.fill('Suggestion')
    await expect(address).toHaveAttribute('aria-expanded', 'true')
    await expect(options).toHaveCount(2)
    await expect(options.nth(0)).toContainText('Bookmark')
    await expect(options.nth(1)).toContainText('History')
    await expect.poll(addressOverlay).toMatchObject({
      attached: true,
      topmost: true,
      visible: true,
      optionCount: 2,
      text: expect.stringContaining('Local only')
    })
    await expect.poll(browserViewY).toBe(browserViewYWithoutPopup)
    await address.fill('No local result should match this query')
    await expect(listbox).toBeHidden()
    await expect.poll(addressOverlay).toMatchObject({ attached: false, visible: false })
    await expect.poll(browserViewY).toBe(browserViewYWithoutPopup)
    await address.fill('Suggestion')
    await expect.poll(addressOverlay).toMatchObject({ attached: true, topmost: true, visible: true })
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(760, 600))
    await expect.poll(() => appWindow.evaluate('window.innerWidth')).toBe(760)
    await expect.poll(addressOverlay).toMatchObject({ attached: true, topmost: true, visible: true })
    await expect.poll(async () => {
      const bounds = (await addressOverlay()).bounds
      return bounds ? bounds.x + bounds.width : Number.POSITIVE_INFINITY
    }).toBeLessThanOrEqual(760)
    const compactPopupBounds = (await addressOverlay()).bounds
    expect(compactPopupBounds).toBeDefined()
    expect(compactPopupBounds!.width).toBeGreaterThanOrEqual(550)
    expect(compactPopupBounds!.x + compactPopupBounds!.width).toBeLessThanOrEqual(760)
    expect(requests).toHaveLength(requestCountBeforeTyping)
    await expect.poll(browserViewY).toBe(browserViewYWithoutPopup)

    // Native views always sit above the renderer. Opening any full application
    // modal must therefore detach the suggestion view before showing the modal.
    await electronApp.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')
      main?.webContents.send('updates:open')
    })
    const settingsDialog = appWindow.getByRole('dialog', { name: 'Settings' })
    await expect(settingsDialog).toBeVisible()
    await expect(settingsDialog.getByRole('heading', { name: 'Software updates' })).toBeVisible()
    await expect.poll(addressOverlay).toMatchObject({ attached: false, visible: false })
    await settingsDialog.getByRole('button', { name: 'Close', exact: true }).click()
    await address.focus()
    await address.fill('Suggestion')
    await expect.poll(addressOverlay).toMatchObject({ attached: true, topmost: true, visible: true })

    const duplicateNavigationTabId = await appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')
    await clickOverlayOption(0)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Suggestion bookmark')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(duplicateNavigationTabId)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.filter((tab) => tab.url === ${JSON.stringify(bookmarkUrl)}).length)`)).toBe(2)

    const directNavigation = await appWindow.evaluate('window.hronaut.newTab({ active: true })') as BrowserState
    const directNavigationTabId = directNavigation.activeTabId
    await address.fill(bookmarkUrl)
    await expect(options).toHaveCount(1)
    await expect(address).not.toHaveAttribute('aria-activedescendant')
    await address.press('Enter')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Suggestion bookmark')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(directNavigationTabId)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.filter((tab) => tab.url === ${JSON.stringify(bookmarkUrl)}).length)`)).toBe(3)

    await appWindow.evaluate(`Promise.all(Array.from({ length: 10 }, (_value, index) => (
      window.hronautBookmarks.add('https://overflow-' + index + '.example/', 'Overflow suggestion ' + index)
    )))`)
    await address.fill('@bookmarks Overflow suggestion')
    await expect(options).toHaveCount(8)
    await expect.poll(overlayScrollTop).toBe(0)
    for (let index = 0; index < 8; index += 1) await address.press('ArrowDown')
    await expect(options.nth(7)).toHaveAttribute('aria-selected', 'true')
    await expect.poll(overlayScrollTop).toBeGreaterThan(0)
    await address.press('Escape')
    await expect(address).toHaveValue(bookmarkUrl)

    await appWindow.evaluate('window.hronaut.newTab({ active: true })')
    await address.fill('@bookmarks Suggestion bookmark')
    await expect(options).toHaveCount(1)
    await expect(listbox).toContainText('Suggestion bookmark')
    await address.press('ArrowDown')
    await address.press('Enter')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Suggestion bookmark')

    await address.fill('@history Suggestion history')
    await expect(options).toHaveCount(1)
    await address.press('ArrowDown')
    await address.press('Enter')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Suggestion history')
    await expect(address).toHaveAttribute('aria-expanded', 'false')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('suggests a committed address before every page resource finishes loading', async ({ appWindow, electronApp }) => {
  let finishPendingResource: (() => void) | undefined
  const server = createServer((request, response) => {
    if (request.url === '/pending-resource') {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.write('resource started')
      finishPendingResource = () => response.end('resource finished')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Committed history</title><main>Ready</main><img src="/pending-resource">')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const serverAddress = server.address()
    if (!serverAddress || typeof serverAddress === 'string') throw new Error('Committed-history fixture did not expose a port')
    const historyUrl = `http://127.0.0.1:${serverAddress.port}/committed`
    const address = appWindow.getByRole('combobox', { name: 'Address' })

    await appWindow.evaluate('window.hronaut.newTab({ active: true })')
    await address.fill(historyUrl)
    await address.press('Enter')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active))')).toMatchObject({
      url: historyUrl,
      title: 'Committed history',
      loading: true
    })

    await appWindow.evaluate('window.hronaut.newTab({ active: true })')
    await address.fill(new URL(historyUrl).hostname)
    const options = appWindow.locator('#address-suggestions [role="option"]')
    await expect(options).toHaveCount(1)
    await expect(options.first()).toContainText('Committed history')

    expect(await appWindow.evaluate(`window.hronautHistory.list().then((entries) => entries.find((entry) => entry.url === ${JSON.stringify(historyUrl)})?.visitCount)`)).toBe(1)
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
      if (!page) throw new Error('Committed-history page was not found')
      page.emit('did-stop-loading')
    }, historyUrl)
    await expect.poll(() => appWindow.evaluate(`window.hronautHistory.list().then((entries) => entries.find((entry) => entry.url === ${JSON.stringify(historyUrl)})?.visitCount)`)).toBe(1)

    finishPendingResource?.()
    finishPendingResource = undefined
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.title === "Committed history")?.loading)')).toBe(false)
    await expect.poll(() => appWindow.evaluate(`window.hronautHistory.list().then((entries) => entries.find((entry) => entry.url === ${JSON.stringify(historyUrl)})?.visitCount)`)).toBe(1)
  } finally {
    finishPendingResource?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('searches open and recently closed tabs, then restores any selected page', async ({ appWindow, electronApp }) => {
  const browserViewBounds = (): Promise<{ x: number; y: number; width: number; height: number } | undefined> => electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows()[0]?.contentView.children[0]?.getBounds()
  ))
  const alphaUrl = 'data:text/html,<title>Tab search alpha</title><main>Alpha</main>'
  const betaUrl = 'data:text/html,<title>Tab search beta</title><main>Beta</main>'
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(alphaUrl)}, active: true })`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Tab search alpha')
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(betaUrl)}, active: true })`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Tab search beta')

  await electronApp.evaluate(({ webContents }, requestedUrl) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
    if (!page) throw new Error('Tab-search fixture web contents was not found')
    page.focus()
    const modifiers = process.platform === 'darwin' ? ['meta', 'shift'] as const : ['control', 'shift'] as const
    page.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: [...modifiers] })
    page.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: [...modifiers] })
  }, betaUrl)

  const panel = appWindow.getByRole('dialog', { name: 'Tabs' })
  const search = panel.getByRole('searchbox', { name: 'Search tabs' })
  await expect(panel).toBeVisible()
  const panelBounds = await panel.boundingBox()
  expect(panelBounds).not.toBeNull()
  await expect.poll(browserViewBounds).toMatchObject({
    x: 0,
    y: 105,
    width: Math.round(panelBounds!.x)
  })
  expect((await browserViewBounds())?.height).toBeGreaterThan(500)
  await expect(search).toBeFocused()
  await expect(panel).toContainText('2 open')
  await search.fill('alpha')
  await expect(panel.locator('.tab-search-item')).toHaveCount(1)
  await expect(panel).toContainText('Tab search alpha')
  await search.press('Enter')
  await expect(panel).toBeHidden()
  await expect.poll(browserViewBounds).toMatchObject({ x: 0, y: 105, width: await appWindow.evaluate('window.innerWidth') })
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Tab search alpha')

  await appWindow.getByRole('button', { name: 'Search tabs' }).click()
  await panel.getByRole('button', { name: 'Close Tab search beta' }).click()
  await expect(panel).toContainText('1 open · 1 closed')
  await expect(panel.getByRole('list', { name: 'Recently closed tabs' })).toContainText('Tab search beta')
  await panel.getByRole('button', { name: 'Close Tab search alpha' }).click()
  await expect(panel).toContainText('0 open · 2 closed')
  await expect(appWindow.locator('.toolbar')).toBeHidden()
  await expect(panel.getByRole('list', { name: 'Recently closed tabs' }).getByRole('listitem')).toHaveCount(2)
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.closedTabs.map(({ id, title, url, pinned, closedAt }) => ({
    hasId: typeof id === 'string' && id.length > 0,
    title,
    url,
    pinned,
    validClosedAt: Number.isFinite(Date.parse(closedAt))
  })))`)).toEqual([
    { hasId: true, title: 'Tab search alpha', url: alphaUrl, pinned: false, validClosedAt: true },
    { hasId: true, title: 'Tab search beta', url: betaUrl, pinned: false, validClosedAt: true }
  ])
  await search.fill('beta')
  await expect(panel.locator('.tab-search-item')).toHaveCount(1)
  await search.press('Enter')
  await expect(panel).toBeHidden()
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Tab search beta')
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.closedTabs.map((tab) => tab.title))')).toEqual(['Tab search alpha'])

  await appWindow.getByRole('button', { name: 'Search tabs' }).click()
  await panel.getByRole('button', { name: 'Restore Tab search alpha' }).click()
  await expect(panel).toBeHidden()
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => ({ active: state.tabs.find((tab) => tab.active)?.title, closed: state.closedTabs.length }))')).toEqual({
    active: 'Tab search alpha',
    closed: 0
  })
})

test('duplicates navigation history and safely bulk-manages tabs from the native menu', async ({
  appWindow,
  electronApp
}) => {
  const firstUrl = 'data:text/html,<title>Context first</title><main>First</main>'
  const secondUrl = 'data:text/html,<title>Context second</title><main>Second</main>'
  const sourceId = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(firstUrl)}, active: true })
    .then((state) => state.tabs.find((tab) => tab.active).id)`) as string
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Context first')
  await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(sourceId)}, url: ${JSON.stringify(secondUrl)} })`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Context second')

  await electronApp.evaluate(({ Menu }) => {
    ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = undefined
    Menu.prototype.popup = function (): void {
      ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = this
    }
  })
  const openSourceMenu = async (): Promise<void> => {
    await appWindow.locator('.tab:not(.pinned)', { hasText: 'Context second' }).first().click({ button: 'right' })
  }
  const clickMenuItem = (id: string): Promise<void> => electronApp.evaluate((_electron, menuId) => {
    const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
    const item = menu?.getMenuItemById(menuId)
    if (!item?.click || !item.enabled) throw new Error(`Enabled ${menuId} context action was not found`)
    ;(item.click as unknown as () => void)()
  }, id)

  await openSourceMenu()
  await clickMenuItem('duplicate-tab')
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.filter((tab) => tab.url === ${JSON.stringify(secondUrl)}).length)`)).toBe(2)
  const duplicateId = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active && tab.id !== ${JSON.stringify(sourceId)})?.id)`) as string
  expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
    .filter((contents) => contents.getURL() === url)
    .map((contents) => contents.navigationHistory.canGoBack()), secondUrl)).toEqual([true, true])
  await appWindow.evaluate(`window.hronaut.back(${JSON.stringify(duplicateId)})`)
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(duplicateId)})?.url)`)).toBe(firstUrl)

  const pinnedId = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(secondUrl)}, active: false })
    .then((state) => state.tabs.findLast((tab) => tab.url === ${JSON.stringify(secondUrl)}).id)`) as string
  await appWindow.evaluate(`window.hronaut.setTabPinned(${JSON.stringify(pinnedId)}, true)`)
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(secondUrl)}, active: false })`)
  await openSourceMenu()
  await clickMenuItem('close-duplicate-tabs')
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.filter((tab) => tab.url === ${JSON.stringify(secondUrl)}).map((tab) => tab.pinned))`)).toEqual([true, false])

  for (const title of ['Context right one', 'Context right two']) {
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`data:text/html,<title>${title}</title>`)}, active: false })`)
  }
  await openSourceMenu()
  await clickMenuItem('close-tabs-to-right')
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.filter((tab) => !tab.url.startsWith("hronaut://")).map((tab) => tab.title))')).toEqual([
    'Context second',
    'Context second'
  ])

  await openSourceMenu()
  await clickMenuItem('reopen-closed-tab')
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.some((tab) => tab.title === "Context right two"))')).toBe(true)
  await openSourceMenu()
  await clickMenuItem('close-other-tabs')
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.filter((tab) => !tab.url.startsWith("hronaut://")).map(({ title, pinned }) => ({ title, pinned })))')).toEqual([
    { title: 'Context second', pinned: true },
    { title: 'Context second', pinned: false }
  ])
})

test('reports stale native tab context actions without throwing into Electron', async ({
  appWindow,
  electronApp
}) => {
  const staleTabId = await appWindow.evaluate(`window.hronaut.newTab({
    url: 'data:text/html,<title>Stale context tab</title><main>Stale</main>',
    active: true
  }).then((state) => state.tabs.find((tab) => tab.active).id)`) as string
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Stale context tab')

  await electronApp.evaluate(({ Menu }) => {
    ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = undefined
    Menu.prototype.popup = function (): void {
      ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = this
    }
  })
  await appWindow.getByRole('tab', { name: /^Stale context tab/ }).click({ button: 'right' })
  await expect.poll(() => electronApp.evaluate(() => (
    (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu })
      .__hronautTabMenu?.getMenuItemById('pin-tab')?.enabled ?? false
  ))).toBe(true)

  await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(staleTabId)})`)
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.some((tab) => tab.id === ${JSON.stringify(staleTabId)}))`)).toBe(false)
  await electronApp.evaluate(() => {
    const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
    const item = menu?.getMenuItemById('pin-tab')
    if (!item?.click) throw new Error('Pin Tab context action was not found')
    ;(item.click as unknown as () => void)()
  })

  await expect(appWindow.getByRole('alert', { name: 'Browser action failed' })).toContainText('The tab is no longer available.')
  await expect(appWindow.getByRole('button', { name: 'Settings' })).toBeEnabled()
})

test('pins tabs from the native menu and tab search while preserving closed-tab state', async ({
  appWindow,
  electronApp,
  profileDirectory
}) => {
  const alphaUrl = 'data:text/html,<title>Pin alpha</title><main>Alpha</main>'
  const betaUrl = 'data:text/html,<title>Pin beta</title><main>Beta</main>'
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(alphaUrl)}, active: true })`)
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(betaUrl)}, active: true })`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Pin beta')

  await electronApp.evaluate(({ Menu }) => {
    ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = undefined
    Menu.prototype.popup = function (): void {
      ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = this
    }
  })
  await appWindow.getByRole('tab', { name: /^Pin beta/ }).click({ button: 'right' })
  const tabMenuItems = (): Promise<Array<{ id: string; label: string; enabled: boolean }>> => electronApp.evaluate(() => {
    const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
    return menu?.items.filter((item) => item.type !== 'separator').map(({ id, label, enabled }) => ({ id, label, enabled })) ?? []
  })
  await expect.poll(tabMenuItems).toEqual([
    { id: 'new-tab', label: 'New Tab', enabled: true },
    { id: 'reload-tab', label: 'Reload Tab', enabled: true },
    { id: 'reload-tab-ignoring-cache', label: 'Reload Tab Without Cache', enabled: true },
    { id: 'duplicate-tab', label: 'Duplicate Tab', enabled: true },
    { id: 'open-in-split-view', label: 'Open Tab Beside', enabled: true },
    { id: 'mute-tab', label: 'Mute Tab', enabled: true },
    { id: 'pin-tab', label: 'Pin Tab', enabled: true },
    { id: 'sleep-tab', label: 'Put Tab to Sleep', enabled: false },
    { id: 'workspace', label: 'Workspace: Default', enabled: true },
    { id: 'move-tab-left', label: 'Move Tab Left', enabled: true },
    { id: 'move-tab-right', label: 'Move Tab Right', enabled: false },
    { id: 'close-tab', label: 'Close Tab', enabled: true },
    { id: 'close-other-tabs', label: 'Close Other Tabs', enabled: true },
    { id: 'close-tabs-to-right', label: 'Close Tabs to the Right', enabled: false },
    { id: 'close-duplicate-tabs', label: 'Close Duplicate Tabs', enabled: false },
    { id: 'reopen-closed-tab', label: 'Reopen Closed Tab', enabled: false }
  ])
  await expect.poll(() => electronApp.evaluate(() => {
    const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
    return menu?.getMenuItemById('workspace')?.submenu?.items
      .filter((item) => item.type !== 'separator')
      .map(({ id, label }) => ({ id, label })) ?? []
  })).toEqual([
    { id: 'new-tab-in-workspace', label: 'New Tab in Workspace' },
    { id: 'edit-workspace', label: 'Edit Workspace…' },
    { id: 'sleep-workspace-tabs', label: 'Sleep Eligible Tabs' },
    { id: 'archive-workspace', label: 'Archive Workspace' }
  ])
  await electronApp.evaluate(() => {
    const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
    const item = menu?.getMenuItemById('move-tab-left')
    if (!item?.click) throw new Error('Move Tab Left context action was not found')
    ;(item.click as unknown as () => void)()
  })
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.filter((tab) => !tab.url.startsWith('hronaut://')).map((tab) => tab.title))`)).toEqual([
    'Pin beta',
    'Pin alpha'
  ])
  await electronApp.evaluate(() => {
    const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
    const item = menu?.getMenuItemById('pin-tab')
    if (!item?.click) throw new Error('Pin Tab context action was not found')
    ;(item.click as unknown as () => void)()
  })

  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.filter((tab) => !tab.url.startsWith('hronaut://')).map(({ title, pinned }) => ({ title, pinned })))`)).toEqual([
    { title: 'Pin beta', pinned: true },
    { title: 'Pin alpha', pinned: false }
  ])
  const pinnedTab = appWindow.locator('.tab.pinned')
  await expect(pinnedTab).toHaveCount(1)
  await expect(pinnedTab).toHaveAttribute('aria-label', /Pin beta — pinned/)
  expect(Math.round((await pinnedTab.boundingBox())!.width)).toBe(40)

  await appWindow.getByRole('button', { name: 'Search tabs' }).click()
  const panel = appWindow.getByRole('dialog', { name: 'Tabs' })
  await panel.getByRole('button', { name: 'Unpin Pin beta' }).click()
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.title === 'Pin beta')?.pinned)`)).toBe(false)
  await panel.getByRole('button', { name: 'Pin Pin beta' }).click()
  await expect(panel.getByRole('button', { name: 'Unpin Pin beta' })).toHaveAttribute('aria-pressed', 'true')
  await appWindow.keyboard.press('Escape')

  const betaId = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.title === 'Pin beta')?.id)`) as string
  await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(betaId)})`)
  await appWindow.evaluate('window.hronaut.reopenClosedTab()')
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.filter((tab) => !tab.url.startsWith('hronaut://')).map(({ title, pinned }) => ({ title, pinned })))`)).toEqual([
    { title: 'Pin beta', pinned: true },
    { title: 'Pin alpha', pinned: false }
  ])
  await expect.poll(async () => {
    const saved = await readFile(join(profileDirectory, 'tabs.json'), 'utf8').catch(() => '')
    if (!saved) return []
    const value = JSON.parse(saved)
    return value.tabs.filter((tab: { url: string }) => !tab.url.startsWith('hronaut://')).map(({ title, pinned }: { title: string; pinned: boolean }) => ({ title, pinned }))
  }).toEqual([
    { title: 'Pin beta', pinned: true },
    { title: 'Pin alpha', pinned: false }
  ])
})

test('contains rejected tab-search mutations and keeps the panel usable', async ({ appWindow, electronApp }) => {
  const title = 'Rejected tab search action'
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`data:text/html,<title>${title}</title>`)}, active: true })`)
  await appWindow.evaluate(() => {
    type RejectionEvent = { reason: unknown; preventDefault: () => void }
    const shellWindow = globalThis as typeof globalThis & {
      __tabSearchUnhandledRejection?: string | null
      __tabSearchUnhandledRejectionListener?: (event: RejectionEvent) => void
      addEventListener(type: 'unhandledrejection', listener: (event: RejectionEvent) => void): void
    }
    shellWindow.__tabSearchUnhandledRejection = null
    shellWindow.__tabSearchUnhandledRejectionListener = (event) => {
      shellWindow.__tabSearchUnhandledRejection = String(event.reason)
      event.preventDefault()
    }
    shellWindow.addEventListener('unhandledrejection', shellWindow.__tabSearchUnhandledRejectionListener)
  })
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('browser:set-tab-pinned')
    ipcMain.handle('browser:set-tab-pinned', () => {
      throw new Error('simulated rejected tab-search pin')
    })
  })

  await appWindow.getByRole('button', { name: 'Search tabs' }).click()
  const panel = appWindow.getByRole('dialog', { name: 'Tabs' })
  await panel.getByRole('button', { name: `Pin ${title}` }).click()

  await expect(appWindow.getByRole('alert', { name: 'Browser action failed' })).toContainText('simulated rejected tab-search pin')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: `Pin ${title}` })).toBeEnabled()
  expect(await appWindow.evaluate(() => {
    type RejectionEvent = { reason: unknown }
    const shellWindow = globalThis as typeof globalThis & {
      __tabSearchUnhandledRejection?: string | null
      __tabSearchUnhandledRejectionListener?: (event: RejectionEvent) => void
      removeEventListener(type: 'unhandledrejection', listener: (event: RejectionEvent) => void): void
    }
    const rejection = shellWindow.__tabSearchUnhandledRejection
    if (shellWindow.__tabSearchUnhandledRejectionListener) {
      shellWindow.removeEventListener('unhandledrejection', shellWindow.__tabSearchUnhandledRejectionListener)
    }
    delete shellWindow.__tabSearchUnhandledRejection
    delete shellWindow.__tabSearchUnhandledRejectionListener
    return rejection
  })).toBeNull()
})

test('puts an active website tab to sleep from its native context menu and wakes it again', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Manual sleep fixture</title><main>Restored after sleep</main><input aria-label="Draft" value="">')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Manual sleep fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/manual-sleep`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Manual sleep fixture')
    const tabId = await appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.id)') as string

    await electronApp.evaluate(({ Menu }) => {
      ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = undefined
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = this
      }
    })
    const tab = appWindow.getByRole('tab', { name: /^Manual sleep fixture/ })
    await tab.click({ button: 'right' })
    await expect.poll(() => electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
      const item = menu?.getMenuItemById('sleep-tab')
      return item ? { label: item.label, enabled: item.enabled } : null
    })).toEqual({ label: 'Put Tab to Sleep', enabled: true })
    await electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
      const item = menu?.getMenuItemById('sleep-tab')
      if (!item?.click) throw new Error('Put Tab to Sleep context action was not found')
      ;(item.click as unknown as () => void)()
    })

    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((candidate) => candidate.id === ${JSON.stringify(tabId)})?.sleeping)`)).toBe(true)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.activeTabId !== ${JSON.stringify(tabId)})`)).toBe(true)
    await expect(tab).toHaveAttribute('aria-label', /sleeping/)

    await tab.click({ button: 'right' })
    await electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
      const item = menu?.getMenuItemById('reload-tab')
      if (!item?.click) throw new Error('Reload Tab context action was not found')
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((candidate) => candidate.id === ${JSON.stringify(tabId)})?.sleeping)`)).toBe(false)
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript('document.body.innerText')
    }, url)).toContain('Restored after sleep')

    await tab.click({ button: 'right' })
    await electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
      const item = menu?.getMenuItemById('sleep-tab')
      if (!item?.click) throw new Error('Put Tab to Sleep context action was not found after reloading')
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((candidate) => candidate.id === ${JSON.stringify(tabId)})?.sleeping)`)).toBe(true)

    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))?.id ?? null
    ))).toBeTruthy()
    const wakingPageId = await electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))?.id
    ))
    if (!wakingPageId) throw new Error('Sleeping manual fixture WebContents was not found')
    await electronApp.evaluate(({ webContents }, pageId) => {
      const page = webContents.fromId(pageId)
      if (!page) throw new Error('Sleeping manual fixture WebContents disappeared')
      const originalRestore = page.navigationHistory.restore.bind(page.navigationHistory)
      const control = { started: false, release: undefined as (() => void) | undefined }
      ;(globalThis as typeof globalThis & { __hronautDelayedWake?: typeof control }).__hronautDelayedWake = control
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async (...args: Parameters<typeof originalRestore>) => {
          control.started = true
          await new Promise<void>((resolve) => { control.release = resolve })
          return originalRestore(...args)
        }
      })
    }, wakingPageId)

    await tab.click({ button: 'right' })
    await expect.poll(() => electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
      const item = menu?.getMenuItemById('wake-tab')
      return item ? { label: item.label, enabled: item.enabled } : null
    })).toEqual({ label: 'Wake Tab', enabled: true })
    await electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
      const item = menu?.getMenuItemById('wake-tab')
      if (!item?.click) throw new Error('Wake Tab context action was not found')
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautDelayedWake?: { started: boolean } })
        .__hronautDelayedWake?.started ?? false
    ))).toBe(true)
    await appWindow.evaluate((requestedTabId) => {
      const shellWindow = globalThis as typeof globalThis & {
        __hronautReloadDuringWake?: Promise<void>
        __hronautReloadDuringWakeSettled?: boolean
        hronaut: { reload: (tabId: string) => Promise<unknown> }
      }
      shellWindow.__hronautReloadDuringWakeSettled = false
      shellWindow.__hronautReloadDuringWake = shellWindow.hronaut.reload(requestedTabId).then(() => undefined).finally(() => {
        shellWindow.__hronautReloadDuringWakeSettled = true
      })
    }, tabId)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(await appWindow.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautReloadDuringWakeSettled?: boolean })
        .__hronautReloadDuringWakeSettled ?? false
    ))).toBe(false)
    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & { __hronautDelayedWake?: { release?: () => void } }).__hronautDelayedWake
      if (!control?.release) throw new Error('Delayed wake was not waiting')
      control.release()
    })
    await appWindow.evaluate(async () => {
      const shellWindow = globalThis as typeof globalThis & { __hronautReloadDuringWake?: Promise<void> }
      await shellWindow.__hronautReloadDuringWake
      delete shellWindow.__hronautReloadDuringWake
      delete (shellWindow as typeof shellWindow & { __hronautReloadDuringWakeSettled?: boolean }).__hronautReloadDuringWakeSettled
    })

    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((candidate) => candidate.id === ${JSON.stringify(tabId)})?.sleeping)`)).toBe(false)
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript('document.body.innerText')
    }, url)).toContain('Restored after sleep')

    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.activeTabId)`)).toBe(tabId)
    await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Woken manual sleep fixture was not found')
      await page.executeJavaScript(`document.querySelector('input').value = 'unsaved draft'`)
    }, url)
    await tab.click({ button: 'right' })
    await electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
      const item = menu?.getMenuItemById('sleep-tab')
      if (!item?.click) throw new Error('Put Tab to Sleep context action was not found')
      ;(item.click as unknown as () => void)()
    })
    await expect(appWindow.getByRole('alert', { name: 'Browser action failed' })).toContainText('partially filled form')
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({ active: state.activeTabId === ${JSON.stringify(tabId)}, sleeping: state.tabs.find((candidate) => candidate.id === ${JSON.stringify(tabId)})?.sleeping }))`)).toEqual({ active: true, sleeping: false })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('rolls back pinning when a sleeping tab cannot wake and permits a retry', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Rejected sleeping pin</title><main>Wake retry restored this page</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Rejected sleeping-pin fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/rejected-sleeping-pin`
    await appWindow.evaluate(`(async () => {
      await window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true });
      await window.hronaut.newTab({ url: 'about:blank', active: true });
    })()`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.title === "Rejected sleeping pin")?.id)')).toBeTruthy()
    const tabId = await appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.title === "Rejected sleeping pin")?.id)') as string
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
      state.tabs.find((candidate) => candidate.id === ${JSON.stringify(tabId)})?.loading
    ))`)).toBe(false)
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(tabId)}, true)`)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))?.id ?? null
    ))).toBeTruthy()

    await electronApp.evaluate(({ Menu, webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))
      if (!page) throw new Error('Sleeping pin fixture WebContents was not found')
      const control = {
        pageId: page.id,
        restore: page.navigationHistory.restore.bind(page.navigationHistory),
        loadUrl: page.loadURL.bind(page)
      }
      ;(globalThis as typeof globalThis & { __hronautRejectedWake?: typeof control }).__hronautRejectedWake = control
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async () => { throw new Error('simulated sleeping tab wake failure') }
      })
      Object.defineProperty(page, 'loadURL', {
        configurable: true,
        value: async () => { throw new Error('simulated sleeping tab wake failure') }
      })
      ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = undefined
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = this
      }
    })

    await appWindow.getByRole('tab', { name: /^Rejected sleeping pin/ }).click({ button: 'right' })
    await electronApp.evaluate(() => {
      const item = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu })
        .__hronautTabMenu?.getMenuItemById('pin-tab')
      if (!item?.click) throw new Error('Pin Tab context action was not found')
      ;(item.click as unknown as () => void)()
    })

    await expect(appWindow.getByRole('alert', { name: 'Browser action failed' })).toContainText('simulated sleeping tab wake failure')
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => {
      const tab = state.tabs.find((candidate) => candidate.id === ${JSON.stringify(tabId)});
      return tab ? { pinned: tab.pinned, sleeping: tab.sleeping } : null;
    })`)).toEqual({ pinned: false, sleeping: true })

    await electronApp.evaluate(({ webContents }) => {
      const control = (globalThis as typeof globalThis & {
        __hronautRejectedWake?: { pageId: number; restore: Electron.NavigationHistory['restore']; loadUrl: Electron.WebContents['loadURL'] }
      }).__hronautRejectedWake
      if (!control) throw new Error('Rejected wake control was not found')
      const page = webContents.fromId(control.pageId)
      if (!page) throw new Error('Sleeping pin fixture WebContents disappeared')
      Object.defineProperty(page.navigationHistory, 'restore', { configurable: true, value: control.restore })
      Object.defineProperty(page, 'loadURL', { configurable: true, value: control.loadUrl })
      delete (globalThis as typeof globalThis & { __hronautRejectedWake?: unknown }).__hronautRejectedWake
    })
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(tabId)}, false)`)
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript('document.body.innerText')
    }, url)).toContain('Wake retry restored this page')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('rolls back selection when a sleeping tab cannot wake and permits a retry', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Rejected sleeping selection</title><main>Selection retry restored this page</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Rejected sleeping-selection fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/rejected-sleeping-selection`
    const created = await appWindow.evaluate(`(async () => {
      const target = await window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true });
      const tabId = target.tabs.find((tab) => tab.url === ${JSON.stringify(url)})?.id;
      const fallback = await window.hronaut.newTab({ url: 'about:blank', active: true });
      return { tabId, fallbackTabId: fallback.activeTabId };
    })()`) as { tabId?: string; fallbackTabId: string | null }
    expect(created.tabId).toBeTruthy()
    expect(created.fallbackTabId).toBeTruthy()
    const tabId = created.tabId!
    const fallbackTabId = created.fallbackTabId!
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
      state.tabs.find((candidate) => candidate.id === ${JSON.stringify(tabId)})?.loading
    ))`)).toBe(false)
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(tabId)}, true)`)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))?.id ?? null
    ))).toBeTruthy()

    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))
      if (!page) throw new Error('Sleeping selection fixture WebContents was not found')
      const control = {
        pageId: page.id,
        restore: page.navigationHistory.restore.bind(page.navigationHistory),
        loadUrl: page.loadURL.bind(page)
      }
      ;(globalThis as typeof globalThis & { __hronautRejectedSelectionWake?: typeof control }).__hronautRejectedSelectionWake = control
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async () => { throw new Error('simulated sleeping selection wake failure') }
      })
      Object.defineProperty(page, 'loadURL', {
        configurable: true,
        value: async () => { throw new Error('simulated sleeping selection wake failure') }
      })
    })

    await appWindow.getByRole('tab', { name: /^Rejected sleeping selection/ }).click()
    await expect(appWindow.getByRole('alert', { name: 'Open tab failed' })).toContainText('simulated sleeping selection wake failure')
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      activeTabId: state.activeTabId,
      sleeping: state.tabs.find((candidate) => candidate.id === ${JSON.stringify(tabId)})?.sleeping
    }))`)).toEqual({ activeTabId: fallbackTabId, sleeping: true })

    await electronApp.evaluate(({ webContents }) => {
      const control = (globalThis as typeof globalThis & {
        __hronautRejectedSelectionWake?: { pageId: number; restore: Electron.NavigationHistory['restore']; loadUrl: Electron.WebContents['loadURL'] }
      }).__hronautRejectedSelectionWake
      if (!control) throw new Error('Rejected selection wake control was not found')
      const page = webContents.fromId(control.pageId)
      if (!page) throw new Error('Sleeping selection fixture WebContents disappeared')
      Object.defineProperty(page.navigationHistory, 'restore', { configurable: true, value: control.restore })
      Object.defineProperty(page, 'loadURL', { configurable: true, value: control.loadUrl })
      delete (globalThis as typeof globalThis & { __hronautRejectedSelectionWake?: unknown }).__hronautRejectedSelectionWake
    })
    await appWindow.getByRole('tab', { name: /^Rejected sleeping selection/ }).click()
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      activeTabId: state.activeTabId,
      sleeping: state.tabs.find((candidate) => candidate.id === ${JSON.stringify(tabId)})?.sleeping
    }))`)).toEqual({ activeTabId: tabId, sleeping: false })
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript('document.body.innerText')
    }, url)).toContain('Selection retry restored this page')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('keeps the active tab when a sleeping close replacement cannot wake', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Sleeping close replacement</title><main>Close retry restored this page</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Sleeping close-replacement fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/sleeping-close-replacement`
    const created = await appWindow.evaluate(async ({ requestedUrl }) => {
      const browser = (window as unknown as { hronaut: HronautApi }).hronaut
      const replacementState = await browser.newTab({ url: requestedUrl, active: true })
      const replacementTabId = replacementState.activeTabId
      const activeState = await browser.newTab({
        url: 'data:text/html,<title>Active close keeper</title><main>Keep this page visible on wake failure</main>',
        active: true
      })
      return { replacementTabId, activeTabId: activeState.activeTabId }
    }, { requestedUrl: url }) as { replacementTabId: string | null; activeTabId: string | null }
    expect(created.replacementTabId).toBeTruthy()
    expect(created.activeTabId).toBeTruthy()
    const replacementTabId = created.replacementTabId!
    const activeTabId = created.activeTabId!
    await expect.poll(() => appWindow.evaluate((tabId) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.getState().then((state) => state.tabs.find((candidate) => candidate.id === tabId)?.loading), replacementTabId)).toBe(false)
    await appWindow.evaluate((tabId) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.setTabSleeping(tabId, true), replacementTabId)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))?.id ?? null
    ))).toBeTruthy()

    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))
      if (!page) throw new Error('Sleeping close-replacement WebContents was not found')
      const control = {
        pageId: page.id,
        restore: page.navigationHistory.restore.bind(page.navigationHistory),
        loadUrl: page.loadURL.bind(page)
      }
      ;(globalThis as typeof globalThis & { __hronautRejectedCloseWake?: typeof control }).__hronautRejectedCloseWake = control
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async () => { throw new Error('simulated close replacement wake failure') }
      })
      Object.defineProperty(page, 'loadURL', {
        configurable: true,
        value: async () => { throw new Error('simulated close replacement wake failure') }
      })
    })

    const rejectedClose = await appWindow.evaluate(async (tabId) => {
      const browser = (window as unknown as { hronaut: HronautApi }).hronaut
      try {
        await browser.closeTab(tabId)
        return { error: null, state: await browser.getState() }
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          state: await browser.getState()
        }
      }
    }, activeTabId)
    expect(rejectedClose.error).toContain('simulated close replacement wake failure')
    expect(rejectedClose.state.activeTabId).toBe(activeTabId)
    expect(rejectedClose.state.tabs.find((candidate) => candidate.id === activeTabId)).toBeTruthy()
    expect(rejectedClose.state.tabs.find((candidate) => candidate.id === replacementTabId)?.sleeping).toBe(true)

    await electronApp.evaluate(({ webContents }) => {
      const control = (globalThis as typeof globalThis & {
        __hronautRejectedCloseWake?: { pageId: number; restore: Electron.NavigationHistory['restore']; loadUrl: Electron.WebContents['loadURL'] }
      }).__hronautRejectedCloseWake
      if (!control) throw new Error('Rejected close wake control was not found')
      const page = webContents.fromId(control.pageId)
      if (!page) throw new Error('Sleeping close-replacement WebContents disappeared')
      Object.defineProperty(page.navigationHistory, 'restore', { configurable: true, value: control.restore })
      Object.defineProperty(page, 'loadURL', { configurable: true, value: control.loadUrl })
      delete (globalThis as typeof globalThis & { __hronautRejectedCloseWake?: unknown }).__hronautRejectedCloseWake
    })
    await appWindow.evaluate((tabId) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.closeTab(tabId), activeTabId)
    await expect.poll(() => appWindow.evaluate(({ closedTabId, selectedTabId }) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.getState().then((state) => ({
      activeTabId: state.activeTabId,
      closedTabPresent: state.tabs.some((candidate) => candidate.id === closedTabId),
      sleeping: state.tabs.find((candidate) => candidate.id === selectedTabId)?.sleeping
    })), { closedTabId: activeTabId, selectedTabId: replacementTabId })).toEqual({
      activeTabId: replacementTabId,
      closedTabPresent: false,
      sleeping: false
    })
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript('document.body.innerText')
    }, url)).toContain('Close retry restored this page')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('keeps a newer selection authoritative while an active close wakes its replacement', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Delayed close replacement</title><main>Delayed replacement restored</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Delayed close-replacement fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/delayed-close-replacement`
    const created = await appWindow.evaluate(async ({ requestedUrl }) => {
      const browser = (window as unknown as { hronaut: HronautApi }).hronaut
      const newer = await browser.newTab({
        url: 'data:text/html,<title>Newer close selection</title><main>Keep this selection authoritative</main>',
        active: true
      })
      const replacement = await browser.newTab({ url: requestedUrl, active: true })
      const active = await browser.newTab({
        url: 'data:text/html,<title>Delayed active close</title><main>Cancel this close after a newer selection</main>',
        active: true
      })
      return {
        newerTabId: newer.activeTabId,
        replacementTabId: replacement.activeTabId,
        activeTabId: active.activeTabId
      }
    }, { requestedUrl: url }) as {
      newerTabId: string | null
      replacementTabId: string | null
      activeTabId: string | null
    }
    expect(created.newerTabId).toBeTruthy()
    expect(created.replacementTabId).toBeTruthy()
    expect(created.activeTabId).toBeTruthy()
    const newerTabId = created.newerTabId!
    const replacementTabId = created.replacementTabId!
    const activeTabId = created.activeTabId!
    await expect.poll(() => appWindow.evaluate((tabId) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.getState().then((state) => state.tabs.find((candidate) => candidate.id === tabId)?.loading), replacementTabId)).toBe(false)
    await appWindow.evaluate((tabId) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.setTabSleeping(tabId, true), replacementTabId)

    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))
      if (!page) throw new Error('Delayed close-replacement WebContents was not found')
      const originalRestore = page.navigationHistory.restore.bind(page.navigationHistory)
      const control = { started: false, release: undefined as (() => void) | undefined }
      ;(globalThis as typeof globalThis & { __hronautDelayedCloseWake?: typeof control }).__hronautDelayedCloseWake = control
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async (...args: Parameters<typeof originalRestore>) => {
          control.started = true
          await new Promise<void>((resolve) => { control.release = resolve })
          return originalRestore(...args)
        }
      })
    })

    await appWindow.evaluate((tabId) => {
      const browser = (window as unknown as { hronaut: HronautApi }).hronaut
      const shellWindow = globalThis as typeof globalThis & { __hronautPendingClose?: Promise<BrowserState> }
      shellWindow.__hronautPendingClose = browser.closeTab(tabId)
    }, activeTabId)
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautDelayedCloseWake?: { started: boolean } })
        .__hronautDelayedCloseWake?.started ?? false
    ))).toBe(true)
    await appWindow.evaluate((tabId) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.selectTab(tabId), newerTabId)
    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __hronautDelayedCloseWake?: { release?: () => void }
      }).__hronautDelayedCloseWake
      if (!control?.release) throw new Error('Delayed close wake was not waiting')
      control.release()
      delete (globalThis as typeof globalThis & { __hronautDelayedCloseWake?: unknown }).__hronautDelayedCloseWake
    })
    await appWindow.evaluate(async () => {
      const shellWindow = globalThis as typeof globalThis & { __hronautPendingClose?: Promise<BrowserState> }
      await shellWindow.__hronautPendingClose
      delete shellWindow.__hronautPendingClose
    })

    await expect.poll(() => appWindow.evaluate(({ expectedActiveTabId, pendingCloseTabId, wokenTabId }) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.getState().then((state) => ({
      activeTabId: state.activeTabId,
      pendingCloseTabPresent: state.tabs.some((candidate) => candidate.id === pendingCloseTabId),
      replacementSleeping: state.tabs.find((candidate) => candidate.id === wokenTabId)?.sleeping,
      expectedActiveTabPresent: state.tabs.some((candidate) => candidate.id === expectedActiveTabId)
    })), {
      expectedActiveTabId: newerTabId,
      pendingCloseTabId: activeTabId,
      wokenTabId: replacementTabId
    })).toEqual({
      activeTabId: newerTabId,
      pendingCloseTabPresent: true,
      replacementSleeping: false,
      expectedActiveTabPresent: true
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('uses the next close replacement when the pending sleeping replacement closes', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Removed close replacement</title><main>Remove this pending replacement</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Removed close-replacement fixture did not expose a port')
    const replacementUrl = `http://127.0.0.1:${address.port}/removed-close-replacement`
    const created = await appWindow.evaluate(async (requestedUrl) => {
      const browser = (window as unknown as { hronaut: HronautApi }).hronaut
      const survivor = await browser.newTab({
        url: 'data:text/html,<title>Close fallback survivor</title><main>Select this page after both closes</main>',
        active: true
      })
      const replacement = await browser.newTab({ url: requestedUrl, active: true })
      const active = await browser.newTab({
        url: 'data:text/html,<title>Removed replacement active close</title><main>Close this page after advancing the fallback</main>',
        active: true
      })
      return {
        survivorTabId: survivor.activeTabId,
        replacementTabId: replacement.activeTabId,
        activeTabId: active.activeTabId
      }
    }, replacementUrl) as {
      survivorTabId: string | null
      replacementTabId: string | null
      activeTabId: string | null
    }
    expect(created.survivorTabId).toBeTruthy()
    expect(created.replacementTabId).toBeTruthy()
    expect(created.activeTabId).toBeTruthy()
    const survivorTabId = created.survivorTabId!
    const replacementTabId = created.replacementTabId!
    const activeTabId = created.activeTabId!
    await expect.poll(() => appWindow.evaluate((tabId) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === tabId)?.loading), replacementTabId)).toBe(false)
    const replacementPageId = await electronApp.evaluate(({ webContents }, requestedUrl) => (
      webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)?.id ?? null
    ), replacementUrl)
    expect(replacementPageId).toBeTruthy()
    await appWindow.evaluate((tabId) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.setTabSleeping(tabId, true), replacementTabId)
    await electronApp.evaluate(({ webContents }, pageId) => {
      const page = webContents.fromId(pageId)
      if (!page) throw new Error('Removed close-replacement WebContents was not found')
      const control = { started: false, release: undefined as (() => void) | undefined }
      ;(globalThis as typeof globalThis & { __hronautRemovedCloseWake?: typeof control }).__hronautRemovedCloseWake = control
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async () => {
          control.started = true
          await new Promise<void>((resolve) => { control.release = resolve })
          throw new Error('simulated removed replacement wake failure')
        }
      })
    }, replacementPageId!)

    await appWindow.evaluate((tabId) => {
      const browser = (window as unknown as { hronaut: HronautApi }).hronaut
      const shellWindow = globalThis as typeof globalThis & { __hronautPendingRemovedClose?: Promise<BrowserState> }
      shellWindow.__hronautPendingRemovedClose = browser.closeTab(tabId)
    }, activeTabId)
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautRemovedCloseWake?: { started: boolean } })
        .__hronautRemovedCloseWake?.started ?? false
    ))).toBe(true)
    await appWindow.evaluate((tabId) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.closeTab(tabId), replacementTabId)
    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __hronautRemovedCloseWake?: { release?: () => void }
      }).__hronautRemovedCloseWake
      if (!control?.release) throw new Error('Removed close wake was not waiting')
      control.release()
      delete (globalThis as typeof globalThis & { __hronautRemovedCloseWake?: unknown }).__hronautRemovedCloseWake
    })
    await appWindow.evaluate(async () => {
      const shellWindow = globalThis as typeof globalThis & { __hronautPendingRemovedClose?: Promise<BrowserState> }
      const pendingClose = shellWindow.__hronautPendingRemovedClose
      if (!pendingClose) throw new Error('Pending removed-replacement close was not found')
      await pendingClose
      delete shellWindow.__hronautPendingRemovedClose
    })

    await expect.poll(() => appWindow.evaluate(({ firstClosedTabId, secondClosedTabId }) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.getState().then((state) => ({
      activeTabId: state.activeTabId,
      firstClosedPresent: state.tabs.some((tab) => tab.id === firstClosedTabId),
      secondClosedPresent: state.tabs.some((tab) => tab.id === secondClosedTabId)
    })), {
      firstClosedTabId: activeTabId,
      secondClosedTabId: replacementTabId
    })).toEqual({
      activeTabId: survivorTabId,
      firstClosedPresent: false,
      secondClosedPresent: false
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('commits one close when duplicate requests wait on the same sleeping replacement', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Shared close replacement</title><main>Wake once for duplicate closes</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Duplicate close fixture did not expose a port')
    const replacementUrl = `http://127.0.0.1:${address.port}/shared-close-replacement`
    const created = await appWindow.evaluate(async (requestedUrl) => {
      const browser = (window as unknown as { hronaut: HronautApi }).hronaut
      const replacement = await browser.newTab({ url: requestedUrl, active: true })
      const active = await browser.newTab({
        url: 'data:text/html,<title>Duplicate pending close</title><main>Record this close only once</main>',
        active: true
      })
      return { replacementTabId: replacement.activeTabId, activeTabId: active.activeTabId }
    }, replacementUrl) as { replacementTabId: string | null; activeTabId: string | null }
    expect(created.replacementTabId).toBeTruthy()
    expect(created.activeTabId).toBeTruthy()
    const replacementTabId = created.replacementTabId!
    const activeTabId = created.activeTabId!
    await expect.poll(() => appWindow.evaluate((tabId) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === tabId)?.loading), replacementTabId)).toBe(false)
    const replacementPageId = await electronApp.evaluate(({ webContents }, requestedUrl) => (
      webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)?.id ?? null
    ), replacementUrl)
    expect(replacementPageId).toBeTruthy()
    await appWindow.evaluate((tabId) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.setTabSleeping(tabId, true), replacementTabId)
    await electronApp.evaluate(({ webContents }, pageId) => {
      const page = webContents.fromId(pageId)
      if (!page) throw new Error('Shared close-replacement WebContents was not found')
      const originalRestore = page.navigationHistory.restore.bind(page.navigationHistory)
      const control = { started: false, release: undefined as (() => void) | undefined }
      ;(globalThis as typeof globalThis & { __hronautSharedCloseWake?: typeof control }).__hronautSharedCloseWake = control
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async (...args: Parameters<typeof originalRestore>) => {
          control.started = true
          await new Promise<void>((resolve) => { control.release = resolve })
          return originalRestore(...args)
        }
      })
    }, replacementPageId!)

    await appWindow.evaluate((tabId) => {
      const browser = (window as unknown as { hronaut: HronautApi }).hronaut
      const shellWindow = globalThis as typeof globalThis & { __hronautDuplicateCloses?: Promise<BrowserState[]> }
      shellWindow.__hronautDuplicateCloses = Promise.all([
        browser.closeTab(tabId),
        browser.closeTab(tabId)
      ])
    }, activeTabId)
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautSharedCloseWake?: { started: boolean } })
        .__hronautSharedCloseWake?.started ?? false
    ))).toBe(true)
    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __hronautSharedCloseWake?: { release?: () => void }
      }).__hronautSharedCloseWake
      if (!control?.release) throw new Error('Shared close wake was not waiting')
      control.release()
      delete (globalThis as typeof globalThis & { __hronautSharedCloseWake?: unknown }).__hronautSharedCloseWake
    })
    await appWindow.evaluate(async () => {
      const shellWindow = globalThis as typeof globalThis & { __hronautDuplicateCloses?: Promise<BrowserState[]> }
      const duplicateCloses = shellWindow.__hronautDuplicateCloses
      if (!duplicateCloses) throw new Error('Duplicate close requests were not found')
      await duplicateCloses
      delete shellWindow.__hronautDuplicateCloses
    })

    await expect.poll(() => appWindow.evaluate((closedTabId) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.getState().then((state) => ({
      activeTabId: state.activeTabId,
      closedTabPresent: state.tabs.some((tab) => tab.id === closedTabId),
      matchingClosedEntries: state.closedTabs.filter((tab) => tab.title === 'Duplicate pending close').length
    })), activeTabId)).toEqual({
      activeTabId: replacementTabId,
      closedTabPresent: false,
      matchingClosedEntries: 1
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('rechecks a reordered sleeping close replacement before committing the close', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((request, response) => {
    const isDelayed = request.url?.includes('delayed-replacement') ?? false
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(isDelayed
      ? '<!doctype html><title>Delayed reordered replacement</title><main>Delayed replacement restored</main>'
      : '<!doctype html><title>Rejected reordered replacement</title><main>Reject this replacement wake</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Reordered close-replacement fixture did not expose a port')
    const rejectedUrl = `http://127.0.0.1:${address.port}/rejected-replacement`
    const delayedUrl = `http://127.0.0.1:${address.port}/delayed-replacement`
    const created = await appWindow.evaluate(async ({ firstUrl, secondUrl }) => {
      const browser = (window as unknown as { hronaut: HronautApi }).hronaut
      const rejected = await browser.newTab({ url: firstUrl, active: true })
      const delayed = await browser.newTab({ url: secondUrl, active: true })
      const active = await browser.newTab({
        url: 'data:text/html,<title>Reordered active close</title><main>Keep this page after replacement failure</main>',
        active: true
      })
      return {
        rejectedTabId: rejected.activeTabId,
        delayedTabId: delayed.activeTabId,
        activeTabId: active.activeTabId
      }
    }, { firstUrl: rejectedUrl, secondUrl: delayedUrl }) as {
      rejectedTabId: string | null
      delayedTabId: string | null
      activeTabId: string | null
    }
    expect(created.rejectedTabId).toBeTruthy()
    expect(created.delayedTabId).toBeTruthy()
    expect(created.activeTabId).toBeTruthy()
    const rejectedTabId = created.rejectedTabId!
    const delayedTabId = created.delayedTabId!
    const activeTabId = created.activeTabId!
    await expect.poll(() => appWindow.evaluate((tabIds) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.getState().then((state) => tabIds.map((tabId) => state.tabs.find((tab) => tab.id === tabId)?.loading)), [
      rejectedTabId,
      delayedTabId
    ])).toEqual([false, false])
    const pageIds = await electronApp.evaluate(({ webContents }, urls) => ({
      rejected: webContents.getAllWebContents().find((contents) => contents.getURL() === urls.rejected)?.id ?? null,
      delayed: webContents.getAllWebContents().find((contents) => contents.getURL() === urls.delayed)?.id ?? null
    }), { rejected: rejectedUrl, delayed: delayedUrl })
    expect(pageIds.rejected).toBeTruthy()
    expect(pageIds.delayed).toBeTruthy()
    await appWindow.evaluate(async (tabIds) => {
      const browser = (window as unknown as { hronaut: HronautApi }).hronaut
      await browser.setTabSleeping(tabIds.rejected, true)
      await browser.setTabSleeping(tabIds.delayed, true)
    }, { rejected: rejectedTabId, delayed: delayedTabId })

    await electronApp.evaluate(({ webContents }, ids) => {
      const delayedPage = webContents.fromId(ids.delayed)
      const rejectedPage = webContents.fromId(ids.rejected)
      if (!delayedPage || !rejectedPage) throw new Error('Reordered close-replacement WebContents were not found')
      const originalDelayedRestore = delayedPage.navigationHistory.restore.bind(delayedPage.navigationHistory)
      const control = { started: false, release: undefined as (() => void) | undefined }
      ;(globalThis as typeof globalThis & { __hronautReorderedCloseWake?: typeof control }).__hronautReorderedCloseWake = control
      Object.defineProperty(delayedPage.navigationHistory, 'restore', {
        configurable: true,
        value: async (...args: Parameters<typeof originalDelayedRestore>) => {
          control.started = true
          await new Promise<void>((resolve) => { control.release = resolve })
          return originalDelayedRestore(...args)
        }
      })
      Object.defineProperty(rejectedPage.navigationHistory, 'restore', {
        configurable: true,
        value: async () => { throw new Error('simulated reordered replacement wake failure') }
      })
      Object.defineProperty(rejectedPage, 'loadURL', {
        configurable: true,
        value: async () => { throw new Error('simulated reordered replacement wake failure') }
      })
    }, { rejected: pageIds.rejected!, delayed: pageIds.delayed! })

    await appWindow.evaluate((tabId) => {
      const browser = (window as unknown as { hronaut: HronautApi }).hronaut
      const shellWindow = globalThis as typeof globalThis & {
        __hronautPendingReorderedClose?: Promise<{ error: string | null; state: BrowserState }>
      }
      shellWindow.__hronautPendingReorderedClose = browser.closeTab(tabId).then(
        (state) => ({ error: null, state }),
        async (error) => ({
          error: error instanceof Error ? error.message : String(error),
          state: await browser.getState()
        })
      )
    }, activeTabId)
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautReorderedCloseWake?: { started: boolean } })
        .__hronautReorderedCloseWake?.started ?? false
    ))).toBe(true)
    await appWindow.evaluate(({ tabId, targetTabId }) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.reorderTab(tabId, targetTabId, 'before'), {
      tabId: delayedTabId,
      targetTabId: rejectedTabId
    })
    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __hronautReorderedCloseWake?: { release?: () => void }
      }).__hronautReorderedCloseWake
      if (!control?.release) throw new Error('Reordered close wake was not waiting')
      control.release()
      delete (globalThis as typeof globalThis & { __hronautReorderedCloseWake?: unknown }).__hronautReorderedCloseWake
    })
    const closeResult = await appWindow.evaluate(async () => {
      const shellWindow = globalThis as typeof globalThis & {
        __hronautPendingReorderedClose?: Promise<{ error: string | null; state: BrowserState }>
      }
      const pendingClose = shellWindow.__hronautPendingReorderedClose
      if (!pendingClose) throw new Error('Pending reordered close was not found')
      const result = await pendingClose
      delete shellWindow.__hronautPendingReorderedClose
      return result
    })

    expect(closeResult.error).toContain('simulated reordered replacement wake failure')
    expect(closeResult.state.activeTabId).toBe(activeTabId)
    expect(closeResult.state.tabs.find((tab) => tab.id === activeTabId)).toBeTruthy()
    expect(closeResult.state.tabs.find((tab) => tab.id === rejectedTabId)?.sleeping).toBe(true)
    expect(closeResult.state.tabs.find((tab) => tab.id === delayedTabId)?.sleeping).toBe(false)
  } finally {
    await closeFixtureServer(server)
  }
})

test('does not override a newer tab selection when a sleeping tab finishes waking', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Delayed sleeping selection</title><main>Delayed selection restored this page</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Delayed sleeping-selection fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/delayed-sleeping-selection`
    const created = await appWindow.evaluate(`(async () => {
      const target = await window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true });
      const tabId = target.tabs.find((tab) => tab.url === ${JSON.stringify(url)})?.id;
      const fallback = await window.hronaut.newTab({ url: 'about:blank', active: true });
      return { tabId, fallbackTabId: fallback.activeTabId };
    })()`) as { tabId?: string; fallbackTabId: string | null }
    expect(created.tabId).toBeTruthy()
    expect(created.fallbackTabId).toBeTruthy()
    const tabId = created.tabId!
    const fallbackTabId = created.fallbackTabId!
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
      state.tabs.find((candidate) => candidate.id === ${JSON.stringify(tabId)})?.loading
    ))`)).toBe(false)
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(tabId)}, true)`)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))?.id ?? null
    ))).toBeTruthy()

    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))
      if (!page) throw new Error('Delayed sleeping selection WebContents was not found')
      const originalRestore = page.navigationHistory.restore.bind(page.navigationHistory)
      const control = { started: false, release: undefined as (() => void) | undefined }
      ;(globalThis as typeof globalThis & { __hronautDelayedSelectionWake?: typeof control }).__hronautDelayedSelectionWake = control
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async (...args: Parameters<typeof originalRestore>) => {
          control.started = true
          await new Promise<void>((resolve) => { control.release = resolve })
          return originalRestore(...args)
        }
      })
    })

    await appWindow.getByRole('tab', { name: /^Delayed sleeping selection/ }).click()
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautDelayedSelectionWake?: { started: boolean } })
        .__hronautDelayedSelectionWake?.started ?? false
    ))).toBe(true)
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(fallbackTabId)})`)
    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __hronautDelayedSelectionWake?: { release?: () => void }
      }).__hronautDelayedSelectionWake
      if (!control?.release) throw new Error('Delayed sleeping selection wake was not waiting')
      control.release()
    })

    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      activeTabId: state.activeTabId,
      sleeping: state.tabs.find((candidate) => candidate.id === ${JSON.stringify(tabId)})?.sleeping,
      loading: state.tabs.find((candidate) => candidate.id === ${JSON.stringify(tabId)})?.loading
    }))`)).toEqual({ activeTabId: fallbackTabId, sleeping: false, loading: false })
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript('document.body.innerText')
    }, url)).toContain('Delayed selection restored this page')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('treats tab closure as cancellation while a sleeping selection is waking', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Closing sleeping selection</title><main>This page should close during wake</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Closing sleeping-selection fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/closing-sleeping-selection`
    const created = await appWindow.evaluate(`(async () => {
      const target = await window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true });
      const tabId = target.tabs.find((tab) => tab.url === ${JSON.stringify(url)})?.id;
      const fallback = await window.hronaut.newTab({ url: 'about:blank', active: true });
      return { tabId, fallbackTabId: fallback.activeTabId };
    })()`) as { tabId?: string; fallbackTabId: string | null }
    expect(created.tabId).toBeTruthy()
    expect(created.fallbackTabId).toBeTruthy()
    const tabId = created.tabId!
    const fallbackTabId = created.fallbackTabId!
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
      state.tabs.find((candidate) => candidate.id === ${JSON.stringify(tabId)})?.loading
    ))`)).toBe(false)
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(tabId)}, true)`)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))?.id ?? null
    ))).toBeTruthy()

    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))
      if (!page) throw new Error('Closing sleeping selection WebContents was not found')
      const control = { started: false, release: undefined as (() => void) | undefined }
      ;(globalThis as typeof globalThis & { __hronautClosingSelectionWake?: typeof control }).__hronautClosingSelectionWake = control
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async () => {
          control.started = true
          await new Promise<void>((resolve) => { control.release = resolve })
          throw new TypeError('Object has been destroyed')
        }
      })
      Object.defineProperty(page, 'loadURL', {
        configurable: true,
        value: async () => { throw new TypeError('Object has been destroyed') }
      })
    })

    await appWindow.evaluate((requestedTabId) => {
      const browser = (window as unknown as { hronaut: HronautApi }).hronaut
      const shellWindow = globalThis as typeof globalThis & {
        __hronautPendingClosingSelection?: Promise<{ error: string | null; state: BrowserState }>
      }
      shellWindow.__hronautPendingClosingSelection = browser.selectTab(requestedTabId).then(
        (state) => ({ error: null, state }),
        async (error) => ({
          error: error instanceof Error ? error.message : String(error),
          state: await browser.getState()
        })
      )
    }, tabId)
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautClosingSelectionWake?: { started: boolean } })
        .__hronautClosingSelectionWake?.started ?? false
    ))).toBe(true)

    const closedState = await appWindow.evaluate((requestedTabId) => (
      window as unknown as { hronaut: HronautApi }
    ).hronaut.closeTab(requestedTabId), tabId)
    expect(closedState.activeTabId).toBe(fallbackTabId)
    expect(closedState.tabs.some((tab) => tab.id === tabId)).toBe(false)
    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __hronautClosingSelectionWake?: { release?: () => void }
      }).__hronautClosingSelectionWake
      if (!control?.release) throw new Error('Closing selection wake was not waiting')
      control.release()
      delete (globalThis as typeof globalThis & { __hronautClosingSelectionWake?: unknown }).__hronautClosingSelectionWake
    })

    const selectionResult = await appWindow.evaluate(async () => {
      const shellWindow = globalThis as typeof globalThis & {
        __hronautPendingClosingSelection?: Promise<{ error: string | null; state: BrowserState }>
      }
      const pending = shellWindow.__hronautPendingClosingSelection
      if (!pending) throw new Error('Pending closing selection was not found')
      const result = await pending
      delete shellWindow.__hronautPendingClosingSelection
      return result
    })
    expect(selectionResult.error).toBeNull()
    expect(selectionResult.state.activeTabId).toBe(fallbackTabId)
    expect(selectionResult.state.tabs.some((tab) => tab.id === tabId)).toBe(false)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('does not override a newer tab selection while a context-menu sleep check is pending', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Delayed context sleep</title><input value="">')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Delayed context-sleep fixture did not expose a port')
    const targetUrl = `http://127.0.0.1:${address.port}/delayed-context-sleep`
    await appWindow.evaluate(`(async () => {
      await window.hronaut.newTab({ url: 'data:text/html,<title>Newer human selection</title>', active: true });
      await window.hronaut.newTab({ url: 'data:text/html,<title>Computed sleep fallback</title>', active: true });
      await window.hronaut.newTab({ url: ${JSON.stringify(targetUrl)}, active: true });
    })()`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Delayed context sleep')
    const ids = await appWindow.evaluate(`window.hronaut.getState().then((state) => Object.fromEntries(
      state.tabs.map((tab) => [tab.title, tab.id])
    ))`) as Record<string, string>
    const targetTabId = ids['Delayed context sleep']
    const newerSelectionId = ids['Newer human selection']
    const computedFallbackId = ids['Computed sleep fallback']
    if (!targetTabId || !newerSelectionId || !computedFallbackId) throw new Error('Context-sleep race tabs were not created')

    await electronApp.evaluate(({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Delayed context-sleep WebContents was not found')
      const originalExecuteJavaScript = page.executeJavaScript.bind(page)
      const control = { calls: 0, started: false, release: undefined as (() => void) | undefined }
      ;(globalThis as typeof globalThis & { __hronautContextSleepCheck?: typeof control }).__hronautContextSleepCheck = control
      Object.defineProperty(page, 'executeJavaScript', {
        configurable: true,
        value: (code: string, userGesture?: boolean) => {
          if (code.includes('window.__hronautContentEditableDirty === true')) {
            control.calls += 1
            if (control.calls === 1) {
              control.started = true
              return new Promise<boolean>((resolve) => {
                control.release = () => resolve(false)
              })
            }
          }
          return originalExecuteJavaScript(code, userGesture)
        }
      })
    }, targetUrl)
    await electronApp.evaluate(({ Menu }) => {
      ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = undefined
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = this
      }
    })

    await appWindow.getByRole('tab', { name: /^Delayed context sleep/ }).click({ button: 'right' })
    await electronApp.evaluate(() => {
      const item = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu })
        .__hronautTabMenu?.getMenuItemById('sleep-tab')
      if (!item?.click || !item.enabled) throw new Error('Enabled Put Tab to Sleep action was not found')
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautContextSleepCheck?: { started: boolean } })
        .__hronautContextSleepCheck?.started ?? false
    ))).toBe(true)

    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(newerSelectionId)})`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(newerSelectionId)
    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __hronautContextSleepCheck?: { release?: () => void }
      }).__hronautContextSleepCheck
      if (!control?.release) throw new Error('Context-menu sleep form check was not waiting')
      control.release()
    })

    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      activeTabId: state.activeTabId,
      sleeping: state.tabs.find((tab) => tab.id === ${JSON.stringify(targetTabId)})?.sleeping
    }))`)).toEqual({ activeTabId: newerSelectionId, sleeping: true })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('keeps native element picking behind modal priority', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Modal picker fixture</title><main>Fixture</main>', active: true })`)
  await appWindow.getByRole('button', { name: 'Create workspace' }).click()
  const editor = appWindow.getByRole('dialog', { name: 'Create workspace' })
  await expect(editor).toBeVisible()
  await appWindow.evaluate(`(() => {
    globalThis.__disposeNativePickShortcutObservation?.()
    globalThis.__nativePickShortcutObserved = false
    globalThis.__disposeNativePickShortcutObservation = window.hronaut.onShortcutRequested((action) => {
      if (action === 'pick-element') globalThis.__nativePickShortcutObserved = true
    })
  })()`)

  await electronApp.evaluate(({ BrowserWindow, Menu }) => {
    const item = Menu.getApplicationMenu()?.items
      .find((candidate) => candidate.label === 'View')?.submenu?.items
      .find((candidate) => candidate.label === 'Pick Element for Agent')
    if (!item?.click) throw new Error('Pick Element for Agent menu item was not found')
    item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
  })
  await expect.poll(() => appWindow.evaluate('globalThis.__nativePickShortcutObserved')).toBe(true)
  await expect(editor).toBeVisible()

  await appWindow.keyboard.press('Escape')

  await expect(editor).toBeHidden()
  await expect(appWindow.getByRole('button', { name: 'Select an element to copy for agent' })).toBeVisible()
  await expect(appWindow.getByRole('button', { name: 'Cancel element selection' })).toHaveCount(0)
  await appWindow.evaluate(`(() => {
    globalThis.__disposeNativePickShortcutObservation?.()
    delete globalThis.__disposeNativePickShortcutObservation
    delete globalThis.__nativePickShortcutObserved
  })()`)
})

test('creates, renames, and permanently closes an isolated human workspace', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Human default tab</title><main>Default</main>', active: true })`)
  await electronApp.evaluate(({ Menu }) => {
    ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = undefined
    Menu.prototype.popup = function (): void {
      ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = this
    }
  })
  const createWorkspaceButton = appWindow.getByRole('button', { name: 'Create workspace' })
  await createWorkspaceButton.click()
  const editor = appWindow.getByRole('dialog', { name: 'Create workspace' })
  await expect(editor).toBeVisible()
  await editor.getByLabel('Workspace name').fill('Human debugging')
  await electronApp.evaluate(({ BrowserWindow, Menu }) => {
    const item = Menu.getApplicationMenu()?.items
      .find((candidate) => candidate.label === 'Help')?.submenu?.items
      .find((candidate) => candidate.label === 'Keyboard Shortcuts')
    if (!item?.click) throw new Error('Keyboard Shortcuts menu item was not found')
    item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
  })
  await expect(editor).toBeVisible()
  await expect(appWindow.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0)
  await electronApp.evaluate(({ BrowserWindow, Menu }) => {
    const item = Menu.getApplicationMenu()?.items
      .find((candidate) => candidate.label === 'View')?.submenu?.items
      .find((candidate) => candidate.label === 'Command Palette…')
    if (!item?.click) throw new Error('Command Palette menu item was not found')
    item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
  })
  await expect(editor).toBeVisible()
  await expect(appWindow.getByRole('dialog', { name: 'Commands' })).toHaveCount(0)
  await appWindow.keyboard.press(`${primaryModifier}+Shift+P`)
  await expect(editor).toBeVisible()
  await expect(appWindow.getByRole('dialog', { name: 'Commands' })).toHaveCount(0)
  await expect(editor.getByRole('radio')).toHaveCount(11)
  await editor.getByRole('radio', { name: 'Orange' }).click()
  await editor.getByRole('button', { name: 'Create workspace' }).click()
  await expect(editor).toBeHidden()
  await expect(createWorkspaceButton).toBeFocused()
  await expect(appWindow.locator('.tab-group-label', { hasText: 'Human debugging' })).toBeVisible()
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((candidate) => candidate.active)?.mcpGroupName)`)).toBe('Human debugging')
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.mcpTabGroups.find((group) => group.name === 'Human debugging')?.color)`)).toBe('orange')
  await expect(appWindow.locator('.tab-group-label', { hasText: 'Human debugging' })).toHaveAttribute('style', /#e08b3e/)

  const workspaceTab = appWindow.getByRole('tab', { name: /^New tab/ })
  const workspaceLabel = appWindow.locator('.tab-group-label', { hasText: 'Human debugging' })
  await workspaceLabel.click({ button: 'right' })
  await expect.poll(() => electronApp.evaluate(() => {
    const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
    return menu?.items.filter((item) => item.type !== 'separator').map(({ id }) => id) ?? []
  })).toEqual(['new-tab-in-workspace', 'edit-workspace', 'sleep-workspace-tabs', 'archive-workspace'])
  await electronApp.evaluate(() => {
    const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
    const item = menu?.getMenuItemById('edit-workspace')
    if (!item?.click) throw new Error('Edit Workspace context action was not found')
    ;(item.click as unknown as () => void)()
  })
  const editDialog = appWindow.getByRole('dialog', { name: 'Edit workspace' })
  await editDialog.getByLabel('Workspace name').fill('Renamed debugging')
  await editDialog.getByRole('button', { name: 'Save changes' }).click()
  const renamedWorkspaceLabel = appWindow.locator('.tab-group-label', { hasText: 'Renamed debugging' })
  await expect(renamedWorkspaceLabel).toBeVisible()

  const workspaceTabId = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.mcpGroupName === 'Renamed debugging')?.id)`) as string
  await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(workspaceTabId)})`)
  await expect(workspaceTab).toBeHidden()
  await renamedWorkspaceLabel.click({ button: 'right' })
  await expect.poll(() => electronApp.evaluate(() => {
    const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
    return menu?.items.filter((item) => item.type !== 'separator').map(({ id }) => id) ?? []
  })).toEqual(['new-tab-in-workspace', 'edit-workspace', 'sleep-workspace-tabs', 'archive-workspace'])
  await electronApp.evaluate(() => {
    const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
    const item = menu?.getMenuItemById('new-tab-in-workspace')
    if (!item?.click) throw new Error('New Tab in Workspace context action was not found')
    ;(item.click as unknown as () => void)()
  })
  await expect(appWindow.getByRole('tab', { name: /^New tab/ })).toBeVisible()

  await renamedWorkspaceLabel.click({ button: 'right' })
  await electronApp.evaluate(() => {
    const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
    ;(menu?.getMenuItemById('edit-workspace')?.click as unknown as (() => void) | undefined)?.()
  })
  appWindow.once('dialog', (dialog) => dialog.accept())
  await appWindow.getByRole('dialog', { name: 'Edit workspace' }).getByRole('button', { name: 'Close workspace', exact: true }).click()
  await expect(appWindow.locator('.tab-group-label', { hasText: 'Renamed debugging' })).toBeHidden()
  await expect(appWindow.getByRole('tab', { name: /^Human default tab/ })).toBeVisible()
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.mcpTabGroups.some((workspace) => workspace.name === 'Renamed debugging'))`)).toBe(false)
})

test('keeps the workspace editor trustworthy while a save is pending', async ({ appWindow, electronApp }, testInfo) => {
  const state = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Pending workspace save', storage: 'scratch' })`) as BrowserState
  const workspaceId = state.mcpTabGroups.find((workspace) => workspace.name === 'Pending workspace save')?.id
  if (!workspaceId) throw new Error('Pending workspace fixture was not created')

  await electronApp.evaluate(({ Menu }) => {
    ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = undefined
    Menu.prototype.popup = function (): void {
      ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = this
    }
  })
  await appWindow.locator('.tab-group-label', { hasText: 'Pending workspace save' }).click({ button: 'right' })
  await expect.poll(() => electronApp.evaluate(() => Boolean(
    (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu })
      .__hronautTabMenu?.getMenuItemById('edit-workspace')?.click
  ))).toBe(true)
  await electronApp.evaluate(() => {
    const item = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu })
      .__hronautTabMenu?.getMenuItemById('edit-workspace')
    if (!item?.click) throw new Error('Edit Workspace context action was not found')
    ;(item.click as unknown as () => void)()
  })

  const editor = appWindow.getByRole('dialog', { name: 'Edit workspace' })
  await expect(editor).toBeVisible()
  await editor.getByLabel('Workspace name').fill('Saved after pending state')

  await electronApp.evaluate(({ ipcMain }, input) => {
    const scope = globalThis as typeof globalThis & { __resolveWorkspaceUpdate?: () => void }
    ipcMain.removeHandler('browser:update-tab-group')
    ipcMain.handle('browser:update-tab-group', () => new Promise((resolve) => {
      scope.__resolveWorkspaceUpdate = () => {
        delete scope.__resolveWorkspaceUpdate
        resolve(input.state)
      }
    }))
  }, { state })

  await editor.getByRole('button', { name: 'Save changes' }).click()
  await expect(editor).toHaveAttribute('aria-busy', 'true')
  await expect(editor.getByRole('status')).toHaveText('Saving workspace…')
  await expect(editor.getByRole('button', { name: 'Close workspace editor' })).toBeDisabled()
  await expect(editor.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await expect(editor.getByRole('button', { name: 'Save changes' })).toBeDisabled()

  await appWindow.keyboard.press('Escape')
  await expect(editor).toBeVisible()
  await appWindow.screenshot({ path: testInfo.outputPath('workspace-editor-save-pending.png') })

  await electronApp.evaluate(() => {
    const resolve = (globalThis as typeof globalThis & { __resolveWorkspaceUpdate?: () => void }).__resolveWorkspaceUpdate
    if (!resolve) throw new Error('Pending workspace update was not captured')
    resolve()
  })
  await expect(editor).toBeHidden()
})

test('keeps the latest workspace editor request when native events resolve out of order', async ({ appWindow, electronApp }) => {
  const olderState = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Older editor request', storage: 'scratch' })`) as BrowserState
  const olderWorkspaceId = olderState.mcpTabGroups.find((workspace) => workspace.name === 'Older editor request')?.id
  const newerState = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Newer editor request', storage: 'scratch' })`) as BrowserState
  const newerWorkspaceId = newerState.mcpTabGroups.find((workspace) => workspace.name === 'Newer editor request')?.id
  if (!olderWorkspaceId || !newerWorkspaceId) throw new Error('Workspace editor race fixtures were not created')

  await electronApp.evaluate(({ BrowserWindow, ipcMain }, input) => {
    const scope = globalThis as typeof globalThis & { __workspaceEditorOlderRequestResolved?: boolean }
    scope.__workspaceEditorOlderRequestResolved = false
    let requestCount = 0
    ipcMain.removeHandler('browser:get-state')
    ipcMain.handle('browser:get-state', () => {
      requestCount += 1
      if (requestCount !== 1) return input.state
      return new Promise((resolve) => {
        setTimeout(() => {
          scope.__workspaceEditorOlderRequestResolved = true
          resolve(input.state)
        }, 75)
      })
    })
    const shellWindow = BrowserWindow.getAllWindows()[0]
    if (!shellWindow) throw new Error('Shell window was not found')
    shellWindow.webContents.send('browser:edit-tab-group', input.olderWorkspaceId)
    setTimeout(() => shellWindow.webContents.send('browser:edit-tab-group', input.newerWorkspaceId), 5)
  }, { state: newerState, olderWorkspaceId, newerWorkspaceId })

  const editor = appWindow.getByRole('dialog', { name: 'Edit workspace' })
  await expect(editor.getByLabel('Workspace name')).toHaveValue('Newer editor request')
  await expect.poll(() => electronApp.evaluate(() => (
    (globalThis as typeof globalThis & { __workspaceEditorOlderRequestResolved?: boolean }).__workspaceEditorOlderRequestResolved
  ))).toBe(true)
  await expect(editor.getByLabel('Workspace name')).toHaveValue('Newer editor request')
  await editor.getByRole('button', { name: 'Cancel' }).click()
})

test('does not open a delayed native workspace editor over newer Settings', async ({ appWindow, electronApp }) => {
  const state = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Delayed editor request', storage: 'scratch' })`) as BrowserState
  const workspaceId = state.mcpTabGroups.find((workspace) => workspace.name === 'Delayed editor request')?.id
  if (!workspaceId) throw new Error('Delayed workspace editor fixture was not created')

  try {
    await electronApp.evaluate(({ BrowserWindow, ipcMain }, input) => {
      const scope = globalThis as typeof globalThis & { __resolveDelayedWorkspaceEditor?: () => void }
      ipcMain.removeHandler('browser:get-state')
      ipcMain.handle('browser:get-state', () => new Promise<BrowserState>((resolve) => {
        scope.__resolveDelayedWorkspaceEditor = () => {
          delete scope.__resolveDelayedWorkspaceEditor
          resolve(input.state)
        }
      }))
      const shellWindow = BrowserWindow.getAllWindows()[0]
      if (!shellWindow) throw new Error('Shell window was not found')
      shellWindow.webContents.send('browser:edit-tab-group', input.workspaceId)
    }, { state, workspaceId })
    await expect.poll(() => electronApp.evaluate(() => Boolean(
      (globalThis as typeof globalThis & { __resolveDelayedWorkspaceEditor?: () => void }).__resolveDelayedWorkspaceEditor
    ))).toBe(true)

    await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = appWindow.getByRole('dialog', { name: 'Settings' })
    await expect(settings).toBeVisible()
    await electronApp.evaluate(() => {
      (globalThis as typeof globalThis & { __resolveDelayedWorkspaceEditor?: () => void }).__resolveDelayedWorkspaceEditor?.()
    })

    await expect(settings).toBeVisible()
    await expect(appWindow.getByRole('dialog', { name: 'Edit workspace' })).toHaveCount(0)
    await expect(appWindow.getByRole('dialog')).toHaveCount(1)
  } finally {
    await electronApp.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __resolveDelayedWorkspaceEditor?: () => void }
      scope.__resolveDelayedWorkspaceEditor?.()
      delete scope.__resolveDelayedWorkspaceEditor
    }).catch(() => undefined)
  }
})

test('archives a workspace from its context menu and restores it with the same stable workspace id', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ Menu }) => {
    ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = undefined
    Menu.prototype.popup = function (): void {
      ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = this
    }
  })
  await appWindow.getByRole('button', { name: 'Create workspace' }).click()
  const editor = appWindow.getByRole('dialog', { name: 'Create workspace' })
  await editor.getByLabel('Workspace name').fill('Saved investigation')
  await editor.getByRole('button', { name: 'Create workspace' }).click()
  const workspaceTabId = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.activeTabId)`) as string
  await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(workspaceTabId)}, url: 'data:text/html,<title>Saved research</title><main>Grouped</main>' })`)
  const originalTab = appWindow.getByRole('tab', { name: /^Saved research/ })
  const workspaceLabel = appWindow.locator('.tab-group-label', { hasText: 'Saved investigation' })
  const originalGroupId = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.mcpTabGroups.find((group) => group.name === 'Saved investigation')?.id)`) as string

  await workspaceLabel.click({ button: 'right' })
  await electronApp.evaluate(() => {
    const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
    const item = menu?.getMenuItemById('archive-workspace')
    if (!item?.click) throw new Error('Archive Workspace context action was not found')
    ;(item.click as unknown as () => void)()
  })
  await expect(originalTab).toBeHidden()
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({ open: state.mcpTabGroups.some((group) => group.id === ${JSON.stringify(originalGroupId)}), saved: state.savedTabGroups.map((group) => ({ name: group.name, tabs: group.tabs.length })) }))`)).toEqual({
    open: false,
    saved: [{ name: 'Saved investigation', tabs: 1 }]
  })

  await appWindow.getByRole('button', { name: 'Search tabs' }).click()
  const panel = appWindow.getByRole('dialog', { name: 'Tabs' })
  await expect(panel.getByText('Archived workspaces')).toBeVisible()
  await panel.getByRole('button', { name: 'Restore archived workspace Saved investigation' }).click()
  await expect(appWindow.getByRole('tab', { name: /^Saved research/ })).toBeVisible()
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({ saved: state.savedTabGroups.length, restored: state.mcpTabGroups.find((group) => group.name === 'Saved investigation')?.id }))`)).toEqual({
    saved: 0,
    restored: originalGroupId
  })
})

test('reorders pinned and regular tabs by dragging and saves the new order', async ({ appWindow, profileDirectory }) => {
  for (const title of ['Drag alpha', 'Drag beta', 'Drag gamma']) {
    const url = `data:text/html,<title>${title}</title><main>${title}</main>`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
  }
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.filter((tab) => !tab.url.startsWith('hronaut://')).map((tab) => tab.title))`)).toEqual([
    'Drag alpha',
    'Drag beta',
    'Drag gamma'
  ])

  const alphaTab = appWindow.getByRole('tab', { name: /^Drag alpha/ })
  const gammaTab = appWindow.getByRole('tab', { name: /^Drag gamma/ })
  await gammaTab.dragTo(alphaTab, { targetPosition: { x: 3, y: 18 } })
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.filter((tab) => !tab.url.startsWith('hronaut://')).map((tab) => tab.title))`)).toEqual([
    'Drag gamma',
    'Drag alpha',
    'Drag beta'
  ])

  await appWindow.evaluate(`window.hronaut.getState().then(async (state) => {
    const gamma = state.tabs.find((tab) => tab.title === 'Drag gamma')
    const alpha = state.tabs.find((tab) => tab.title === 'Drag alpha')
    await window.hronaut.setTabPinned(gamma.id, true)
    await window.hronaut.setTabPinned(alpha.id, true)
  })`)
  await alphaTab.dragTo(gammaTab, { targetPosition: { x: 3, y: 18 } })
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.filter((tab) => !tab.url.startsWith('hronaut://')).map(({ title, pinned }) => ({ title, pinned })))`)).toEqual([
    { title: 'Drag alpha', pinned: true },
    { title: 'Drag gamma', pinned: true },
    { title: 'Drag beta', pinned: false }
  ])
  await expect(appWindow.locator('.tab.pinned')).toHaveCount(2)
  await expect.poll(async () => {
    const saved = await readFile(join(profileDirectory, 'tabs.json'), 'utf8').catch(() => '')
    if (!saved) return []
    const value = JSON.parse(saved)
    return value.tabs.filter((tab: { url: string }) => !tab.url.startsWith('hronaut://')).map(({ title, pinned }: { title: string; pinned: boolean }) => ({ title, pinned }))
  }).toEqual([
    { title: 'Drag alpha', pinned: true },
    { title: 'Drag gamma', pinned: true },
    { title: 'Drag beta', pinned: false }
  ])
})

test('restores pinned tabs ahead of regular tabs after restart', async ({ profileDirectory, mcpPort }) => {
  const alphaUrl = 'data:text/html,<title>Restored pin alpha</title><main>Alpha</main>'
  const betaUrl = 'data:text/html,<title>Restored pin beta</title><main>Beta</main>'
  let first: Awaited<ReturnType<typeof launchHronaut>> | undefined
  let second: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    first = await launchHronaut(profileDirectory, mcpPort)
    await first.window.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(alphaUrl)}, active: true })`)
    await first.window.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(betaUrl)}, active: true })`)
    await expect.poll(() => first!.window.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Restored pin beta')
    await first.window.evaluate(`window.hronaut.getState().then((state) => window.hronaut.setTabPinned(state.tabs.find((tab) => tab.title === 'Restored pin beta').id, true))`)
    await expect.poll(async () => {
      const saved = await readFile(join(profileDirectory, 'tabs.json'), 'utf8').catch(() => '')
      if (!saved) return undefined
      const value = JSON.parse(saved)
      return value.tabs.find((tab: { title: string }) => tab.title === 'Restored pin beta')?.pinned
    }).toBe(true)
    await closeHronaut(first.app)
    first = undefined

    second = await launchHronaut(profileDirectory, mcpPort)
    await expect.poll(() => second!.window.evaluate(`window.hronaut.getState().then((state) => state.tabs.filter((tab) => !tab.url.startsWith('hronaut://')).map(({ title, pinned }) => ({ title, pinned })))`)).toEqual([
      { title: 'Restored pin beta', pinned: true },
      { title: 'Restored pin alpha', pinned: false }
    ])
    await expect(second.window.locator('.tab.pinned')).toHaveCount(1)
  } finally {
    if (first) await closeHronaut(first.app)
    if (second) await closeHronaut(second.app)
  }
})

test('saves, searches, renames, and removes local bookmarks', async ({ appWindow, profileDirectory }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Bookmark fixture</title><main>Saved page</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Bookmark fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Bookmark fixture')

    const bookmarksButton = appWindow.getByRole('button', { name: 'Bookmarks', exact: true })
    await bookmarksButton.focus()
    await appWindow.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+D`)
    const panel = appWindow.getByRole('dialog', { name: 'Bookmarks' })
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('Bookmark fixture')
    await expect(bookmarksButton).toHaveAttribute('title', /current page saved/)
    await expect.poll(async () => {
      const value = JSON.parse(await readFile(join(profileDirectory, 'bookmarks.json'), 'utf8'))
      return value.bookmarks?.[0]
    }).toMatchObject({ url, title: 'Bookmark fixture' })

    await panel.getByRole('searchbox', { name: 'Search bookmarks' }).fill('does not match')
    await expect(panel).toContainText('No matching bookmarks')
    await panel.getByRole('searchbox', { name: 'Search bookmarks' }).fill('Bookmark')
    await panel.getByRole('button', { name: 'Rename Bookmark fixture' }).click()
    await panel.getByRole('textbox', { name: 'Rename Bookmark fixture' }).fill('Renamed bookmark')
    await panel.getByRole('button', { name: 'Save name for Bookmark fixture' }).click()
    await expect(panel).toContainText('Renamed bookmark')
    await panel.getByRole('button', { name: 'Remove Renamed bookmark' }).click()
    await expect(panel).toContainText('No bookmarks yet')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('records, searches, removes, and clears local browsing history', async ({ appWindow, electronApp, profileDirectory }) => {
  const browserViewBounds = (): Promise<{ x: number; y: number; width: number; height: number } | undefined> => electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows()[0]?.contentView.children[0]?.getBounds()
  ))
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    const title = request.url?.startsWith('/beta') ? 'History beta' : 'History alpha'
    response.end(`<!doctype html><title>${title}</title><main>${title}</main>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('History fixture did not expose a port')
    const alphaUrl = `http://127.0.0.1:${address.port}/alpha`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(alphaUrl)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronautHistory.list()')).toEqual([
      expect.objectContaining({ url: alphaUrl, title: 'History alpha', visitCount: 1 })
    ])

    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(`${alphaUrl}#details`)} })`)
    await expect.poll(() => appWindow.evaluate('window.hronautHistory.list()')).toEqual([
      expect.objectContaining({ url: alphaUrl, title: 'History alpha', visitCount: 2 })
    ])

    await appWindow.getByRole('button', { name: 'Browsing history' }).focus()
    await appWindow.keyboard.press(process.platform === 'darwin' ? 'Meta+Y' : 'Control+H')
    const panel = appWindow.getByRole('dialog', { name: 'Browsing history' })
    await expect(panel).toBeVisible()
    const panelBounds = await panel.boundingBox()
    expect(panelBounds).not.toBeNull()
    await expect.poll(browserViewBounds).toMatchObject({
      x: 0,
      y: 105,
      width: Math.round(panelBounds!.x)
    })
    await expect(panel).toContainText('2 visits')
    await panel.getByRole('searchbox', { name: 'Search browsing history' }).fill('does not match')
    await expect(panel).toContainText('No matching visits')
    await panel.getByRole('searchbox', { name: 'Search browsing history' }).fill('alpha')
    await panel.getByRole('button', { name: 'Remove History alpha from history' }).click()
    await expect(panel).toContainText('No browsing history yet')

    const betaUrl = `http://127.0.0.1:${address.port}/beta`
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(betaUrl)} })`)
    await expect.poll(() => appWindow.evaluate('window.hronautHistory.list()')).toEqual([
      expect.objectContaining({ url: betaUrl, title: 'History beta' })
    ])
    appWindow.once('dialog', (dialog) => void dialog.accept())
    await panel.getByRole('button', { name: 'Clear all' }).click()
    await expect(panel).toContainText('No browsing history yet')
    await expect.poll(async () => {
      const value = JSON.parse(await readFile(join(profileDirectory, 'history.json'), 'utf8'))
      return value.entries
    }).toEqual([])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('does not count restored tabs as new browsing-history visits', async ({ profileDirectory, mcpPort }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Restored history fixture</title><main>Restored page</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  let first: Awaited<ReturnType<typeof launchHronaut>> | undefined
  let second: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Restored-history fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/restored`
    first = await launchHronaut(profileDirectory, mcpPort)
    await first.window.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => first!.window.evaluate('window.hronautHistory.list()')).toEqual([
      expect.objectContaining({ url, visitCount: 1 })
    ])
    await closeHronaut(first.app)
    first = undefined

    second = await launchHronaut(profileDirectory, mcpPort)
    await expect.poll(() => second!.window.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.url === ${JSON.stringify(url)}))`)).toMatchObject({
      title: 'Restored history fixture',
      loading: false
    })
    expect(await second.window.evaluate('window.hronautHistory.list()')).toEqual([
      expect.objectContaining({ url, visitCount: 1 })
    ])
  } finally {
    if (first) await closeHronaut(first.app)
    if (second) await closeHronaut(second.app)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('renders a sanitized page favicon and exposes per-tab audio controls', async ({ appWindow, electronApp }) => {
  const favicon = await readFile(new URL('../../build/icons/24x24.png', import.meta.url))
  const server = createServer((request, response) => {
    if (request.url === '/favicon.png') {
      response.writeHead(200, { 'content-length': String(favicon.length), 'content-type': 'image/png' })
      response.end(favicon)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Favicon fixture</title><link rel="icon" href="/favicon.png"><main>Tab identity fixture</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port')
    const url = `http://127.0.0.1:${address.port}/favicon`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.faviconDataUrl)')).toMatch(/^data:image\/png;base64,/)
    await expect(appWindow.locator('.tab.active .favicon-image')).toHaveAttribute('src', /^data:image\/png;base64,/)

    await electronApp.evaluate(({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Favicon fixture web contents was not found')
      page.emit('audio-state-changed', { audible: true } as Electron.Event<Electron.WebContentsAudioStateChangedEventParams>)
    }, url)
    const tabControl = appWindow.getByRole('tab', { name: /Favicon fixture/ })
    await expect(tabControl).toHaveAttribute('aria-keyshortcuts', 'Delete M')
    await expect(tabControl.locator('.tab-audio')).toBeVisible()
    await tabControl.focus()
    await tabControl.press('m')
    await expect.poll(() => electronApp.evaluate(({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.isAudioMuted()
    }, url)).toBe(true)
    await tabControl.locator('.tab-audio').click()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.muted)')).toBe(false)

    await tabControl.locator('.tab-audio').evaluate((element) => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.muted)')).toBe(false)
    await expect.poll(() => electronApp.evaluate(({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.isAudioMuted()
    }, url)).toBe(false)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('finds text from a website shortcut and navigates page matches', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html>
      <title>Find fixture</title>
      <main>
        <p>First needle result.</p>
        <p>Second needle result.</p>
        <p>Third needle result.</p>
      </main>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port')
    const url = `http://127.0.0.1:${address.port}/find`
    const homeTabId = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.url.startsWith('hronaut://home'))?.id)`)
    const findTabId = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true }).then((state) => state.activeTabId)`)
    if (!homeTabId || !findTabId) throw new Error('Find lifecycle tabs were not available')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Find fixture')

    await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Find fixture web contents was not found')
      page.focus()
      const modifiers = process.platform === 'darwin' ? ['meta'] as const : ['control'] as const
      page.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: [...modifiers] })
      page.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: [...modifiers] })
    }, url)

    const findBar = appWindow.getByRole('search', { name: 'Find in page' })
    await expect(findBar).toBeVisible()
    await findBar.getByRole('searchbox', { name: 'Find text' }).fill('needle')
    await expect(findBar.locator('.find-count')).toHaveText('1 / 3')
    await findBar.getByRole('button', { name: 'Next match' }).click()
    await expect(findBar.locator('.find-count')).toHaveText('2 / 3')
    await findBar.getByRole('button', { name: 'Previous match' }).click()
    await expect(findBar.locator('.find-count')).toHaveText('1 / 3')

    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(homeTabId)})`)
    await expect(findBar).toBeHidden()
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(findTabId)})`)
    await expect(findBar).toBeHidden()

    await appWindow.getByRole('button', { name: 'Find in page' }).click()
    await expect(findBar).toBeVisible()
    await expect(findBar.locator('.find-count')).toHaveText('1 / 3')
    await appWindow.keyboard.press('Escape')
    await expect(findBar).toBeHidden()
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('zooms website content with familiar shortcuts and visible controls', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Zoom fixture</title><main>Zoom this page</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port')
    const url = `http://127.0.0.1:${address.port}/zoom`
    const homeTabId = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.url.startsWith('hronaut://home'))?.id)`)
    const zoomTabId = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true }).then((state) => state.activeTabId)`)
    if (!homeTabId || !zoomTabId) throw new Error('Zoom lifecycle tabs were not available')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Zoom fixture')

    await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Zoom fixture web contents was not found')
      page.focus()
      const modifiers = process.platform === 'darwin' ? ['meta', 'shift'] as const : ['control', 'shift'] as const
      page.sendInputEvent({ type: 'keyDown', keyCode: '=', modifiers: [...modifiers] })
      page.sendInputEvent({ type: 'keyUp', keyCode: '=', modifiers: [...modifiers] })
    }, url)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.zoomPercent)')).toBe(110)

    await appWindow.getByRole('button', { name: 'Page zoom controls' }).click()
    const controls = appWindow.getByRole('group', { name: 'Page zoom controls' })
    await expect(controls).toBeVisible()
    await expect(controls.locator('output')).toHaveText('110%')
    await controls.getByRole('button', { name: 'Zoom out' }).click()
    await expect(controls.locator('output')).toHaveText('100%')
    await controls.getByRole('button', { name: 'Zoom in' }).click()
    await expect(controls.locator('output')).toHaveText('110%')
    await controls.getByRole('button', { name: 'Reset' }).click()
    await expect(controls.locator('output')).toHaveText('100%')

    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(homeTabId)})`)
    await expect(controls).toBeHidden()
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(zoomTabId)})`)
    await expect(controls).toBeHidden()

    await appWindow.getByRole('button', { name: 'Page zoom controls' }).click()
    await expect(controls).toBeVisible()
    await appWindow.keyboard.press('Escape')
    await expect(controls).toBeHidden()
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('shows a native webpage context menu and suppresses it while human interaction is locked', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((request, response) => {
    if (request.url === '/image.png') {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+4X2WAAAAAElFTkSuQmCC', 'base64'))
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html>
      <title>Context menu fixture</title>
      <a id="link" href="/target">Open target</a>
      <textarea id="editor">Editable text</textarea>
      <img id="image" src="/image.png" alt="Fixture image" width="40" height="40">`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port')
    const url = `http://127.0.0.1:${address.port}/context`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Context menu fixture')

    await electronApp.evaluate(({ Menu }) => {
      ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = this
      }
    })
    const rightClick = async (selector: string): Promise<void> => {
      await electronApp.evaluate(async ({ webContents }, input: { requestedUrl: string; selector: string }) => {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
        const page = webContents.getAllWebContents().find((contents) => contents.getURL() === input.requestedUrl)
        if (!page) throw new Error('Context menu fixture web contents was not found')
        const point = await page.executeJavaScript(`(() => {
          const bounds = document.querySelector(${JSON.stringify(input.selector)}).getBoundingClientRect()
          return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        })()`)
        page.focus()
        page.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point })
        page.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point })
      }, { requestedUrl: url, selector })
    }
    const contextMenuItems = (): Promise<Array<{ id: string; label: string; enabled: boolean }>> => electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu
      return menu?.items.map(({ id, label, enabled }) => ({ id, label, enabled })) ?? []
    })

    await rightClick('#link')
    await expect.poll(contextMenuItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'open-link-new-tab', label: 'Open Link in New Tab', enabled: true }),
      expect.objectContaining({ id: 'copy-link-address', label: 'Copy Link Address' }),
      expect.objectContaining({ id: 'save-link', label: 'Save Link', enabled: true }),
      expect.objectContaining({ id: 'reload', label: 'Reload' }),
      expect.objectContaining({ id: 'reload-ignoring-cache', label: 'Reload Without Cache' }),
      expect.objectContaining({ id: 'inspect-element', label: 'Inspect' })
    ]))

    await electronApp.evaluate(({ clipboard }) => {
      clipboard.clear()
      const menu = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu
      const item = menu?.getMenuItemById('copy-link-address')
      if (!item?.click) throw new Error('Copy Link Address context action was not found')
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(`http://127.0.0.1:${address.port}/target`)

    await electronApp.evaluate(({ clipboard }) => {
      clipboard.clear()
      const menu = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu
      const item = menu?.getMenuItemById('copy-page-address')
      if (!item?.click) throw new Error('Copy Page Address context action was not found')
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(url)

    await rightClick('#link')
    await expect.poll(contextMenuItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'copy-link-address', label: 'Copy Link Address' })
    ]))
    await electronApp.evaluate(({ clipboard }) => {
      const menu = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu
      const item = menu?.getMenuItemById('copy-link-address')
      if (!item?.click) throw new Error('Copy Link Address context action was not found')
      const originalReadText = clipboard.readText
      clipboard.readText = () => ''
      ;(item.click as unknown as () => void)()
      setTimeout(() => { clipboard.readText = originalReadText }, 500)
    })
    const copyFailure = appWindow.getByRole('alert', { name: 'Copy failed' })
    await expect(copyFailure).toBeVisible()
    await expect(copyFailure).toContainText('system clipboard did not accept it')
    await new Promise((resolve) => setTimeout(resolve, 600))

    await electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu
      const item = menu?.getMenuItemById('open-link-new-tab')
      if (!item?.click) throw new Error('Open Link in New Tab context action was not found')
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState()')).toMatchObject({
      tabs: expect.arrayContaining([expect.objectContaining({ url: `http://127.0.0.1:${address.port}/target`, active: false })])
    })

    await rightClick('#editor')
    await expect.poll(contextMenuItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'undo', label: 'Undo' }),
      expect.objectContaining({ id: 'paste', label: 'Paste' }),
      expect.objectContaining({ id: 'select-all', label: 'Select All' })
    ]))

    await rightClick('#image')
    await expect.poll(contextMenuItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'copy-image', label: 'Copy Image' }),
      expect.objectContaining({ id: 'copy-image-address', label: 'Copy Image Address' }),
      expect.objectContaining({ id: 'save-image', label: 'Save Image', enabled: true })
    ]))
    await electronApp.evaluate(({ clipboard }) => {
      clipboard.clear()
      const menu = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu
      const item = menu?.getMenuItemById('copy-image-address')
      if (!item?.click) throw new Error('Copy Image Address context action was not found')
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(`http://127.0.0.1:${address.port}/image.png`)

    await electronApp.evaluate(({ clipboard }) => {
      clipboard.clear()
      const menu = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu
      const item = menu?.getMenuItemById('copy-image')
      if (!item?.click) throw new Error('Copy Image context action was not found')
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => {
      const image = clipboard.readImage()
      return { empty: image.isEmpty(), size: image.getSize(), pngBytes: image.toPNG().byteLength }
    })).toEqual({ empty: false, size: { width: 1, height: 1 }, pngBytes: expect.any(Number) })

    await rightClick('#image')
    await expect.poll(contextMenuItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'copy-image', label: 'Copy Image' })
    ]))
    await electronApp.evaluate(({ clipboard, nativeImage }) => {
      const menu = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu
      const item = menu?.getMenuItemById('copy-image')
      if (!item?.click) throw new Error('Copy Image context action was not found')
      const originalReadImage = clipboard.readImage
      clipboard.readImage = () => nativeImage.createEmpty()
      ;(item.click as unknown as () => void)()
      setTimeout(() => { clipboard.readImage = originalReadImage }, 700)
    })
    const imageCopyFailure = appWindow.getByRole('alert', { name: 'Copy failed' })
    await expect(imageCopyFailure).toBeVisible()
    await expect(imageCopyFailure).toContainText('system clipboard did not accept it')
    await new Promise((resolve) => setTimeout(resolve, 800))

    await rightClick('#link')
    await expect.poll(contextMenuItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'reload', label: 'Reload' }),
      expect.objectContaining({ id: 'save-link', label: 'Save Link' })
    ]))
    const staleTabId = await appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)') as string
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(staleTabId)})`)
    await electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu
      const item = menu?.getMenuItemById('reload')
      if (!item?.click) throw new Error('Reload context action was not found')
      ;(item.click as unknown as () => void)()
    })
    const actionFailure = appWindow.getByRole('alert', { name: 'Reload failed' })
    await expect(actionFailure).toBeVisible()
    await expect(actionFailure).toContainText('The tab is no longer available')
    await expect(actionFailure).not.toContainText(staleTabId)

    await electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu
      const item = menu?.getMenuItemById('save-link')
      if (!item?.click) throw new Error('Save Link context action was not found')
      ;(item.click as unknown as () => void)()
    })
    const saveFailure = appWindow.getByRole('alert', { name: 'Save link failed' })
    await expect(saveFailure).toBeVisible()
    await expect(saveFailure).toContainText('The tab is no longer available')
    await expect(saveFailure).not.toContainText(staleTabId)

    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Context menu fixture')

    const activeTabId = await appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)') as string
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(activeTabId)}, true)`)
    await electronApp.evaluate(() => {
      ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
    })
    await rightClick('#link')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(await contextMenuItems()).toEqual([])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('preserves intercepted new-tab requests and background disposition', async ({ appWindow, electronApp }) => {
  let received: { method?: string; body: string; contentType?: string; referrer?: string } | undefined
  let backgroundReferrer: string | undefined
  const server = createServer((request, response) => {
    if (request.url === '/submit') {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        received = {
          method: request.method,
          body: Buffer.concat(chunks).toString('utf8'),
          contentType: request.headers['content-type'],
          referrer: request.headers.referer
        }
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end('<!doctype html><title>POST received</title><h1>Submitted</h1>')
      })
      return
    }
    if (request.url === '/background') {
      backgroundReferrer = request.headers.referer
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Background opened</title><h1>Background tab</h1>')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html>
      <title>Target blank form</title>
      <form id="post-form" method="post" action="/submit" target="_blank">
        <input name="message" value="agent workspace">
        <input name="count" value="2">
        <button type="submit">Submit in new tab</button>
      </form>
      <a id="background-link" href="/background" target="_blank">Open in background</a>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port')
    const url = `http://127.0.0.1:${address.port}/form`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'))
      .toBe('Target blank form')

    await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Form fixture web contents was not found')
      await page.executeJavaScript(`document.querySelector('#post-form').requestSubmit()`)
    }, url)

    await expect.poll(() => received).toMatchObject({
      method: 'POST',
      body: 'message=agent+workspace&count=2',
      contentType: expect.stringContaining('application/x-www-form-urlencoded'),
      referrer: url
    })
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'))
      .toBe('POST received')

    const formTabId = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.url === ${JSON.stringify(url)})?.id)`) as string
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(formTabId)})`)
    await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Form fixture web contents was not found')
      const point = await page.executeJavaScript(`(() => {
        const bounds = document.querySelector('#background-link').getBoundingClientRect()
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      })()`)
      page.focus()
      page.sendInputEvent({ type: 'mouseDown', button: 'middle', clickCount: 1, ...point })
      page.sendInputEvent({ type: 'mouseUp', button: 'middle', clickCount: 1, ...point })
    }, url)

    const backgroundUrl = `http://127.0.0.1:${address.port}/background`
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState()')).toMatchObject({
      activeTabId: formTabId,
      tabs: expect.arrayContaining([
        expect.objectContaining({ url: backgroundUrl, title: 'Background opened', active: false })
      ])
    })
    expect(backgroundReferrer).toBe(url)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('shows live download progress with cancel, clear, and reveal-in-folder actions', async ({
  appWindow,
  electronApp,
  profileDirectory
}) => {
  const server = createServer((request, response) => {
    if (request.url === '/slow.bin') {
      response.writeHead(200, {
        'content-disposition': 'attachment; filename="slow.bin"',
        'content-length': '65536',
        'content-type': 'application/octet-stream'
      })
      response.write(Buffer.alloc(1024, 1))
      return
    }
    if (request.url === '/complete.txt') {
      const body = Buffer.from('completed download fixture')
      response.writeHead(200, {
        'content-disposition': 'attachment; filename="complete.txt"',
        'content-length': String(body.length),
        'content-type': 'text/plain'
      })
      response.end(body)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html>
      <title>Download fixture</title>
      <a id="slow" href="/slow.bin" download>Slow download</a>
      <a id="complete" href="/complete.txt" download>Complete download</a>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port')
    const url = `http://127.0.0.1:${address.port}/downloads`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Download fixture')

    const clickPageLink = (selector: string): Promise<void> => electronApp.evaluate(async ({ webContents }, input: { url: string; selector: string }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === input.url)
      if (!page) throw new Error('Download fixture web contents was not found')
      await page.executeJavaScript(`document.querySelector(${JSON.stringify(input.selector)}).click()`)
    }, { url, selector })

    const customDownloadDirectory = join(profileDirectory, 'chosen-downloads')
    await mkdir(customDownloadDirectory)
    await electronApp.evaluate(({ dialog, shell }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
      shell.openPath = async (path): Promise<string> => {
        ;(globalThis as typeof globalThis & { __hronautOpenedDownloadDirectory?: string }).__hronautOpenedDownloadDirectory = path
        return ''
      }
    }, customDownloadDirectory)
    await appWindow.getByRole('button', { name: 'Settings' }).click()
    const settingsDialog = appWindow.getByRole('dialog', { name: 'Settings' })
    await settingsDialog.getByRole('button', { name: /Downloads Location and prompts/ }).click()
    await expect(settingsDialog.getByText(profileDirectory, { exact: true })).toBeVisible()
    await settingsDialog.getByRole('button', { name: 'Change…' }).click()
    await expect(settingsDialog.getByText(customDownloadDirectory, { exact: true })).toBeVisible()
    await expect(settingsDialog).toContainText('New website downloads will use this folder.')
    await settingsDialog.getByRole('button', { name: 'Open folder' }).click()
    await expect.poll(() => electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __hronautOpenedDownloadDirectory?: string }
    ).__hronautOpenedDownloadDirectory)).toBe(customDownloadDirectory)

    const askWhere = settingsDialog.getByRole('checkbox', { name: 'Ask where to save each file' })
    await askWhere.check()
    await expect(askWhere).toBeChecked()
    await electronApp.evaluate(({ session }) => {
      session.fromPartition('persist:hronaut').once('will-download', (_event, item) => {
        ;(globalThis as typeof globalThis & {
          __hronautDownloadDialog?: { savePath: string; defaultPath?: string }
        }).__hronautDownloadDialog = {
          savePath: item.getSavePath(),
          defaultPath: item.getSaveDialogOptions().defaultPath
        }
        item.cancel()
      })
    })
    await clickPageLink('#complete')
    await expect.poll(() => electronApp.evaluate(() => (
      globalThis as typeof globalThis & {
        __hronautDownloadDialog?: { savePath: string; defaultPath?: string }
      }
    ).__hronautDownloadDialog)).toEqual({
      savePath: '',
      defaultPath: join(customDownloadDirectory, 'complete.txt')
    })
    await expect.poll(() => appWindow.evaluate('window.hronautDownloads.list()')).toEqual([
      expect.objectContaining({ filename: 'complete.txt', state: 'cancelled' })
    ])
    await appWindow.evaluate('window.hronautDownloads.clearFinished()')
    await askWhere.uncheck()
    await expect(askWhere).not.toBeChecked()
    await settingsDialog.getByRole('button', { name: 'Close', exact: true }).click()

    const panel = appWindow.getByRole('dialog', { name: 'Downloads' })

    await clickPageLink('#slow')
    await expect(panel).toBeVisible()
    const panelBounds = await panel.boundingBox()
    expect(panelBounds).not.toBeNull()
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows()[0]?.contentView.children[0]?.getBounds()
    ))).toMatchObject({
      x: 0,
      y: 105,
      width: Math.round(panelBounds!.x)
    })
    await expect(panel.getByText('slow.bin', { exact: true })).toBeVisible()
    await expect(panel.getByRole('progressbar', { name: 'Downloading slow.bin' })).toBeVisible()
    await panel.getByRole('button', { name: 'Cancel slow.bin' }).click()
    await expect(panel.getByText('Cancelled', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Clear finished' }).click()
    await expect(panel.getByText('No downloads yet')).toBeVisible()
    await panel.getByRole('button', { name: 'Close downloads' }).click()
    await expect(panel).toBeHidden()

    await electronApp.evaluate(({ shell }) => {
      shell.showItemInFolder = (path): void => {
        ;(globalThis as typeof globalThis & { __hronautRevealedDownload?: string }).__hronautRevealedDownload = path
      }
    })
    await clickPageLink('#complete')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('complete.txt', { exact: true })).toBeVisible()
    await expect(panel.getByText(/Complete/)).toBeVisible()
    await panel.getByRole('button', { name: 'Show complete.txt in folder' }).click()
    await expect.poll(() => electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __hronautRevealedDownload?: string }
    ).__hronautRevealedDownload)).toBe(join(customDownloadDirectory, 'complete.txt'))
    await panel.getByRole('button', { name: 'Clear finished' }).click()
    await expect(panel.getByText('No downloads yet')).toBeVisible()

    await appWindow.getByRole('button', { name: 'Settings' }).click()
    await settingsDialog.getByRole('button', { name: /Downloads Location and prompts/ }).click()
    await settingsDialog.getByRole('button', { name: 'Reset to default' }).click()
    await expect(settingsDialog.getByText(profileDirectory, { exact: true })).toBeVisible()
    await expect(settingsDialog.getByRole('checkbox', { name: 'Ask where to save each file' })).not.toBeChecked()
    const persisted = JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')) as {
      downloadDirectory?: string | null
      askWhereToSaveDownloads?: boolean
    }
    expect(persisted).toMatchObject({ downloadDirectory: null, askWhereToSaveDownloads: false })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('locks website input and tab closing across Hronaut while keeping browser chrome usable', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((request, response) => {
    if (request.url?.includes('interaction-lock-frame')) {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><style>body { min-height: 4000px; margin: 0; }</style><p>Cross-origin frame</p>')
      return
    }
    const fixtureTitle = request.url?.includes('second') ? 'Interaction lock second' : 'Interaction lock first'
    const port = request.headers.host?.split(':').at(-1)
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html>
      <title>${fixtureTitle}</title>
      <style>body { min-height: 4000px; }</style>
      <button id="action" style="position:fixed;left:20px;top:20px;width:160px;height:48px">Take action</button>
      <iframe title="Cross-origin scroll fixture" src="http://localhost:${port}/interaction-lock-frame" style="position:fixed;left:220px;top:20px;width:360px;height:260px"></iframe>
      <output id="count">0</output>
      <script>
        window.fixtureClicks = 0
        window.fixtureWheelEvents = 0
        window.__hronautHumanInteractionWheelGuard = () => { throw new Error('page-owned guard collision') }
        window.addEventListener('wheel', (event) => {
          window.fixtureWheelEvents += 1
          event.stopImmediatePropagation()
        }, { capture: true, passive: true })
        document.querySelector('#action').addEventListener('click', () => {
          window.fixtureClicks += 1
          document.querySelector('#count').textContent = String(window.fixtureClicks)
        })
      </script>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const clickFixture = async (path: string): Promise<void> => {
    await electronApp.evaluate(async ({ webContents }, requestedPath) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes(requestedPath))
      if (!page) throw new Error(`Fixture web contents was not found: ${requestedPath}`)
      const point = await page.executeJavaScript(`(() => {
        const bounds = document.querySelector('#action').getBoundingClientRect()
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      })()`)
      page.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
      page.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
      await new Promise<void>((resolve) => setImmediate(resolve))
    }, path)
  }
  const fixtureClicks = (path: string): Promise<number> => electronApp.evaluate(
    async ({ webContents }, requestedPath) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes(requestedPath))
      if (!page) return -1
      return page.executeJavaScript('window.fixtureClicks')
    },
    path
  )
  const scrollFixture = async (path: string): Promise<void> => {
    await electronApp.evaluate(async ({ webContents }, requestedPath) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes(requestedPath))
      if (!page) throw new Error(`Fixture web contents was not found: ${requestedPath}`)
      page.sendInputEvent({ type: 'mouseWheel', x: 260, y: 220, deltaY: -600, canScroll: true })
      await new Promise<void>((resolve) => setImmediate(resolve))
    }, path)
  }
  const fixtureScrollY = (path: string): Promise<number> => electronApp.evaluate(
    async ({ webContents }, requestedPath) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes(requestedPath))
      if (!page) return -1
      return page.executeJavaScript('window.scrollY')
    },
    path
  )
  const fixtureWheelEvents = (path: string): Promise<number> => electronApp.evaluate(
    async ({ webContents }, requestedPath) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes(requestedPath))
      if (!page) return -1
      return page.executeJavaScript('window.fixtureWheelEvents')
    },
    path
  )
  const scrollFrame = async (path: string): Promise<void> => {
    await electronApp.evaluate(async ({ webContents }, requestedPath) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes(requestedPath))
      if (!page) throw new Error(`Fixture web contents was not found: ${requestedPath}`)
      const point = await page.executeJavaScript(`(() => {
        const bounds = document.querySelector('iframe').getBoundingClientRect()
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      })()`)
      page.sendInputEvent({ type: 'mouseWheel', ...point, deltaY: -600, canScroll: true })
      await new Promise<void>((resolve) => setImmediate(resolve))
    }, path)
  }
  const frameScrollY = (path: string): Promise<number> => electronApp.evaluate(
    async ({ webContents }, requestedPath) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes(requestedPath))
      const frame = page?.mainFrame.framesInSubtree.find((candidate) => candidate.url.includes('/interaction-lock-frame'))
      return frame ? Number(await frame.executeJavaScript('window.scrollY')) : -1
    },
    path
  )
  const scrollFixtureWithNativeWheel = async (path: string): Promise<void> => {
    const point = await electronApp.evaluate(({ BrowserWindow }, requestedPath) => {
      const window = BrowserWindow.getAllWindows()[0]
      const view = window?.contentView.children.find((candidate) => (
        'webContents' in candidate
        && (candidate as Electron.WebContentsView).webContents.getURL().includes(requestedPath)
      ))
      if (!window || !view) throw new Error(`Fixture view was not found: ${requestedPath}`)
      const windowBounds = window.getBounds()
      const viewBounds = view.getBounds()
      return {
        x: windowBounds.x + viewBounds.x + Math.round(viewBounds.width / 2),
        y: windowBounds.y + viewBounds.y + Math.min(320, Math.round(viewBounds.height / 2))
      }
    }, path)
    await execFileAsync('python3', [
      join(process.cwd(), 'tests/integration/x11-input.py'),
      String(point.x),
      String(point.y),
      '--wheel'
    ])
  }

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port')
    const firstPath = '/interaction-lock-first'
    const secondPath = '/interaction-lock-second'
    const baseUrl = `http://127.0.0.1:${address.port}`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${baseUrl}${firstPath}`)}, active: true })`)
    await expect.poll(() => fixtureClicks(firstPath)).toBe(0)

    await clickFixture(firstPath)
    await expect.poll(() => fixtureClicks(firstPath)).toBe(1)

    await appWindow.getByRole('button', { name: 'Lock page input in this tab' }).click()
    await expect(appWindow.getByRole('button', { name: 'Unlock page input in this tab' })).toHaveAttribute('aria-pressed', 'true')
    await clickFixture(firstPath)
    await expect.poll(() => fixtureClicks(firstPath)).toBe(1)
    await scrollFixture(firstPath)
    await expect.poll(() => fixtureScrollY(firstPath)).toBe(0)
    await expect.poll(() => fixtureWheelEvents(firstPath)).toBe(0)
    await scrollFixtureWithNativeWheel(firstPath)
    await expect.poll(() => fixtureScrollY(firstPath)).toBe(0)
    await expect.poll(() => fixtureWheelEvents(firstPath)).toBe(0)
    await expect.poll(() => frameScrollY(firstPath)).toBe(0)
    await scrollFrame(firstPath)
    await expect.poll(() => frameScrollY(firstPath)).toBe(0)

    await electronApp.evaluate(async ({ webContents }, requestedPath) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes(requestedPath))
      await page?.executeJavaScript(`document.querySelector('#action').click()`)
    }, firstPath)
    await expect.poll(() => fixtureClicks(firstPath)).toBe(2)

    await appWindow.getByRole('button', { name: 'Unlock page input in this tab' }).click()
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${baseUrl}${secondPath}`)}, active: true })`)
    await expect.poll(() => fixtureClicks(secondPath)).toBe(0)
    const browserLock = appWindow.getByRole('button', { name: /Lock all tabs/ })
    const tabLock = appWindow.getByRole('button', { name: 'Lock page input in this tab' })
    const [browserLockBounds, tabLockBounds] = await Promise.all([browserLock.boundingBox(), tabLock.boundingBox()])
    expect(browserLockBounds?.y).toBeLessThan(tabLockBounds?.y ?? 0)
    await browserLock.click()
    await expect(appWindow.getByRole('button', { name: 'Unlock all tabs' })).toHaveAttribute('aria-pressed', 'true')

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    const lockedPageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
    await expect(lockedPageTools).toBeVisible()
    await appWindow.keyboard.press('F12')
    await expect(lockedPageTools).toBeVisible()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.devToolsOpen)'))
      .toBe(false)
    await appWindow.getByRole('button', { name: 'Close page tools', exact: true }).click()

    await appWindow.getByRole('button', { name: 'Settings' }).click()
    await expect(appWindow.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await appWindow.getByRole('button', { name: 'Close settings' }).click()

    await appWindow.getByRole('tab', { name: /Interaction lock second/ }).locator('.tab-close').evaluate((element) => {
      ;(element as unknown as { click: () => void }).click()
    })
    await expect(appWindow.getByRole('tab')).toHaveCount(2)

    await electronApp.evaluate(({ Menu }) => {
      ;(globalThis as typeof globalThis & { __hronautLockedTabMenu?: Electron.Menu }).__hronautLockedTabMenu = undefined
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautLockedTabMenu?: Electron.Menu }).__hronautLockedTabMenu = this
      }
    })
    await appWindow.getByRole('tab', { name: /Interaction lock first/ }).click({ button: 'right' })
    await expect.poll(() => electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __hronautLockedTabMenu?: Electron.Menu }).__hronautLockedTabMenu
      return ['close-tab', 'close-other-tabs', 'close-tabs-to-right', 'close-duplicate-tabs']
        .map((id) => ({ id, enabled: menu?.getMenuItemById(id)?.enabled }))
    })).toEqual([
      { id: 'close-tab', enabled: false },
      { id: 'close-other-tabs', enabled: false },
      { id: 'close-tabs-to-right', enabled: false },
      { id: 'close-duplicate-tabs', enabled: false }
    ])

    await electronApp.evaluate(({ clipboard }) => clipboard.clear())
    await appWindow.getByRole('button', { name: 'Open Hronaut Home' }).click()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.url)'))
      .toBe('hronaut://home/')
    await electronApp.evaluate(async ({ webContents }) => {
      const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
      if (!home) throw new Error('Hronaut Home web contents was not found while tabs were locked')
      const guidePoint = await home.executeJavaScript(`(() => {
        const bounds = document.querySelector('[data-guide="opencode"]').getBoundingClientRect()
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      })()`)
      home.focus()
      home.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...guidePoint })
      home.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...guidePoint })
      const point = await home.executeJavaScript(`(() => {
        const bounds = document.querySelector('[data-copy-target="guide-code"]').getBoundingClientRect()
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      })()`)
      home.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
      home.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
    })
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain('https://opencode.ai/config.json')
    await expect(appWindow.getByRole('button', { name: 'Unlock all tabs' })).toHaveAttribute('aria-pressed', 'true')
    await appWindow.getByRole('tab', { name: /Interaction lock second/ }).click()

    await clickFixture(secondPath)
    await expect.poll(() => fixtureClicks(secondPath)).toBe(0)
    await scrollFixture(secondPath)
    await expect.poll(() => fixtureScrollY(secondPath)).toBe(0)
    await expect.poll(() => fixtureWheelEvents(secondPath)).toBe(0)
    await scrollFixtureWithNativeWheel(secondPath)
    await expect.poll(() => fixtureScrollY(secondPath)).toBe(0)
    await expect.poll(() => fixtureWheelEvents(secondPath)).toBe(0)
    const firstTabId = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.url.includes(${JSON.stringify(firstPath)})).id)`)
    const secondTabId = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.url.includes(${JSON.stringify(secondPath)})).id)`)
    await appWindow.getByRole('tab', { name: /Interaction lock first/ }).click()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(firstTabId)
    await clickFixture(firstPath)
    await expect.poll(() => fixtureClicks(firstPath)).toBe(2)

    await appWindow.keyboard.press('Control+W')
    await expect(appWindow.getByRole('tab')).toHaveCount(2)
    await appWindow.keyboard.press('Control+Tab')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(secondTabId)
    await appWindow.keyboard.press('Control+Shift+Tab')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(firstTabId)

    await appWindow.getByRole('button', { name: 'Unlock all tabs' }).click()
    await expect(appWindow.getByRole('button', { name: /Lock all tabs/ })).toHaveAttribute('aria-pressed', 'false')
    await appWindow.getByRole('tab', { name: /Interaction lock second/ }).click()
    await electronApp.evaluate(async ({ webContents }, requestedPath) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes(requestedPath))
      await page?.executeJavaScript('window.scrollTo(0, 0)')
    }, secondPath)
    await scrollFixtureWithNativeWheel(secondPath)
    await expect.poll(() => fixtureScrollY(secondPath)).toBeGreaterThan(0)
    await expect.poll(() => fixtureWheelEvents(secondPath)).toBeGreaterThan(0)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('rolls back tab and global interaction locks when the native input guard fails', async ({
  appWindow,
  electronApp
}) => {
  const fixtureUrl = 'data:text/html,<title>Interaction guard failure</title><button id="action" style="width:160px;height:48px">Take action</button><script>window.fixtureClicks=0;document.querySelector("%23action").addEventListener("click",()=>window.fixtureClicks+=1)</script>'
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(fixtureUrl)}, active: true })`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'))
    .toBe('Interaction guard failure')
  const fixture = await appWindow.evaluate(`window.hronaut.getState().then((state) => ({
    tabId: state.activeTabId,
    url: state.tabs.find((tab) => tab.active)?.url
  }))`) as { tabId: string; url: string }
  const { tabId, url: activeUrl } = fixture

  const failNextNativeGuard = async (failureMethod: 'Input.setIgnoreInputEvents' | 'Page.getFrameTree'): Promise<void> => {
    await electronApp.evaluate(({ webContents }, options) => {
      const { requestedUrl, failureMethod: requestedFailureMethod } = options
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error(`Interaction guard fixture was not found: ${requestedUrl}`)
      const debuggerApi = page.debugger
      const original = debuggerApi.sendCommand.bind(debuggerApi)
      let shouldFail = true
      let lockGuardStarted = false
      Object.defineProperty(debuggerApi, 'sendCommand', {
        configurable: true,
        value: async (method: string, commandParams?: Record<string, unknown>, sessionId?: string) => {
          if (method === 'Input.setIgnoreInputEvents' && commandParams?.ignore === true) {
            lockGuardStarted = true
          }
          const belongsToLockAttempt = requestedFailureMethod === 'Input.setIgnoreInputEvents'
            ? commandParams?.ignore === true
            : lockGuardStarted
          if (method === requestedFailureMethod && belongsToLockAttempt && shouldFail) {
            shouldFail = false
            throw new Error('Synthetic native input guard failure')
          }
          return original(method, commandParams, sessionId)
        }
      })
    }, { requestedUrl: activeUrl, failureMethod })
  }
  const clickFixture = async (): Promise<void> => {
    await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Interaction guard fixture was not found')
      const point = await page.executeJavaScript(`(() => {
        const bounds = document.querySelector('#action').getBoundingClientRect()
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      })()`)
      page.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
      page.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
      await new Promise<void>((resolve) => setImmediate(resolve))
    }, activeUrl)
  }
  const fixtureClicks = (): Promise<number> => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
    return page ? Number(await page.executeJavaScript('window.fixtureClicks')) : -1
  }, activeUrl)

  // Fail after Chromium has already ignored input so the rollback must actively
  // remove the native compositor guard, not merely restore the reported flag.
  await failNextNativeGuard('Page.getFrameTree')
  const tabError = await appWindow.evaluate(`window.hronaut
    .setTabHumanInteractionLocked(${JSON.stringify(tabId)}, true)
    .then(() => null, (error) => String(error))`)
  expect(tabError).toContain('Synthetic native input guard failure')
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.humanInteractionLocked)`))
    .toBe(false)
  await clickFixture()
  await expect.poll(fixtureClicks).toBe(1)

  await failNextNativeGuard('Input.setIgnoreInputEvents')
  const globalError = await appWindow.evaluate(`window.hronaut
    .setAllHumanInteractionLocked(true)
    .then(() => null, (error) => String(error))`)
  expect(globalError).toContain('Synthetic native input guard failure')
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.allHumanInteractionLocked)'))
    .toBe(false)
  await clickFixture()
  await expect.poll(fixtureClicks).toBe(2)
})

test('returns physical keyboard focus to trusted chrome after agent input in a locked tab', async ({
  appWindow,
  mcpPort,
  mcpToken
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Locked agent focus</title><input autofocus>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const client = new Client({ name: 'hronaut-locked-agent-focus-test', version: '1.0.0' })
  const authorization = `Bearer ${mcpToken}`
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization } }
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port')
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization } })).ok
      } catch {
        return false
      }
    }).toBe(true)
    await client.connect(transport)
    await useMcpWorkspace(client, 'Locked agent focus tests', false)
    const opened = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `http://127.0.0.1:${address.port}/locked-agent-focus`, active: true }
    }) as CallToolResult
    expect(opened.isError, mcpResultText(opened)).not.toBe(true)
    const tabId = (JSON.parse(mcpResultText(opened)) as { activeTabId: string }).activeTabId
    const ready = await client.callTool({ name: 'browser_wait', arguments: { tabId } }) as CallToolResult
    expect(ready.isError, mcpResultText(ready)).not.toBe(true)

    await appWindow.getByRole('button', { name: 'Lock page input in this tab' }).click()
    const pressed = await client.callTool({
      name: 'browser_press',
      arguments: { tabId, key: 'Escape' }
    }) as CallToolResult
    expect(pressed.isError, mcpResultText(pressed)).not.toBe(true)
    await execFileAsync('python3', [
      join(process.cwd(), 'tests/integration/x11-input.py'),
      '0',
      '0',
      '--shortcut=Control_L+l'
    ])

    await expect(appWindow.getByRole('combobox', { name: 'Address' })).toBeFocused()
  } finally {
    await client.close().catch(() => undefined)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('picks a page element and copies safe agent-ready DOM context from an MCP-created tab', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html>
      <title>Picker fixture</title>
      <style>body { min-height: 4000px; }</style>
      <main><button id="save-profile" class="primary action" value="internal-secret" style="box-sizing:border-box;width:140px;height:44px;color:rgb(255,255,255);background:rgb(60,40,180)">Save profile</button><input id="password" type="password" value="snapshot-password-secret"></main>
      <script>window.fixtureClicks = 0; document.querySelector('button').addEventListener('click', () => window.fixtureClicks += 1)</script>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const client = new Client({ name: 'hronaut-human-element-picker-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port')
    const url = `http://127.0.0.1:${address.port}/picker?mode=test&created=mcp&token=snapshot-url-secret#fragment`
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, {
          headers: { authorization: `Bearer ${mcpToken}` }
        })).ok
      } catch {
        return false
      }
    }).toBe(true)
    await client.connect(transport)
    await useMcpWorkspace(client, 'Human element picker tests', false)
    const opened = await client.callTool({ name: 'browser_new_tab', arguments: { url, active: true } }) as CallToolResult
    expect(opened.isError, mcpResultText(opened)).not.toBe(true)
    const mcpTabId = (JSON.parse(mcpResultText(opened)) as { activeTabId: string }).activeTabId
    const ready = await client.callTool({ name: 'browser_wait', arguments: { tabId: mcpTabId } }) as CallToolResult
    expect(ready.isError, mcpResultText(ready)).not.toBe(true)
    await expect
      .poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.url)'))
      .toContain('/picker?mode=test&created=mcp&token=snapshot-url-secret#fragment')

    await electronApp.evaluate(({ clipboard }) => clipboard.clear())
    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    let pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
    await pageTools.getByRole('button', { name: 'Copy page snapshot for agent' }).click()
    await expect(appWindow.getByRole('status', { name: 'Page snapshot copied' })).toBeVisible()
    const copiedSnapshot = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(copiedSnapshot).toContain('TITLE: Picker fixture')
    expect(copiedSnapshot).toContain('[e1] button "Save profile"')
    expect(copiedSnapshot).toContain('TEXT: Save profile')
    expect(copiedSnapshot).toContain('token=%5BREDACTED%5D')
    expect(copiedSnapshot).not.toContain('snapshot-password-secret')
    expect(copiedSnapshot).not.toContain('snapshot-url-secret')
    expect(copiedSnapshot).not.toContain('#fragment')
    await pageTools.getByRole('button', { name: 'Close page tools' }).click()

    const picker = appWindow.getByRole('button', { name: 'Select an element to copy for agent' })
    await expect(picker).toBeEnabled()
    await picker.click()
    await expect(appWindow.getByRole('button', { name: 'Cancel element selection' })).toBeVisible()
    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
    await expect(pageTools.getByRole('button', { name: 'Cancel element selection' })).toBeVisible()
    await pageTools.getByRole('button', { name: 'Close page tools' }).click()

    await expect
      .poll(() => electronApp.evaluate(async ({ webContents }) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
        return page?.executeJavaScript(`Boolean(document.querySelector('[data-hronaut-element-picker="overlay"]'))`)
      }))
      .toBe(true)

    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
      if (!page) throw new Error('Picker fixture web contents was not found')
      await page.executeJavaScript(`document.querySelector('#save-profile').dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        composed: true,
        clientX: 40,
        clientY: 30
      }))`)
    })
    await expect
      .poll(() => electronApp.evaluate(async ({ webContents }) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
        return page?.executeJavaScript(`(() => ({
          layers: ['margin', 'overlay', 'padding', 'content'].map((name) => ({
            name,
            display: getComputedStyle(document.querySelector('[data-hronaut-element-picker="' + name + '"]')).display
          })),
          label: document.querySelector('[data-hronaut-element-picker="label"]')?.textContent || ''
        }))()`)
      }))
      .toEqual({
        layers: [
          { name: 'margin', display: 'block' },
          { name: 'overlay', display: 'block' },
          { name: 'padding', display: 'block' },
          { name: 'content', display: 'block' }
        ],
        label: expect.stringContaining('#save-profile · 140 × 44 px')
      })
    const pickerTooltip = await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
      return page?.executeJavaScript(`document.querySelector('[data-hronaut-element-picker="label"]')?.textContent || ''`)
    })
    expect(pickerTooltip).toContain('padding ')
    expect(pickerTooltip).toContain('margin ')
    expect(pickerTooltip).toContain('button "Save profile" · keyboard focusable')
    expect(pickerTooltip).toContain('Click to copy · Esc to cancel')

    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
      if (!page) throw new Error('Picker fixture web contents was not found')
      page.focus()
      page.sendInputEvent({ type: 'mouseMove', x: 40, y: 30, movementX: 0, movementY: 0 })
      page.sendInputEvent({ type: 'mouseDown', x: 40, y: 30, button: 'left', clickCount: 1 })
      page.sendInputEvent({ type: 'mouseUp', x: 40, y: 30, button: 'left', clickCount: 1 })
    })

    await expect(appWindow.getByRole('button', { name: 'Element copied for agent' })).toBeVisible()
    await appWindow.getByRole('button', { name: 'Element copied for agent' }).click()
    await expect(appWindow.getByRole('button', { name: 'Cancel element selection' })).toBeVisible()
    await new Promise((resolve) => setTimeout(resolve, 1_600))
    await expect(appWindow.getByRole('button', { name: 'Cancel element selection' })).toBeVisible()
    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
    await expect(pageTools.getByRole('button', { name: 'Cancel element selection' })).toBeVisible()
    await pageTools.getByRole('button', { name: 'Close page tools' }).click()
    const clipboardText = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(clipboardText).toContain('Selected DOM element')
    expect(clipboardText).toContain('Page: Picker fixture')
    expect(clipboardText).toContain('Selector: #save-profile')
    expect(clipboardText).toContain('Element: <button id="save-profile" class="primary action">Save profile</button>')
    expect(clipboardText).toContain('Text: "Save profile"')
    expect(clipboardText).toContain('Box model:')
    expect(clipboardText).toContain('Layout: display=')
    expect(clipboardText).toContain('Typography: color=rgb(255, 255, 255)')
    expect(clipboardText).toContain('Accessibility: role=button; name="Save profile"; focusable=true; disabled=false')
    expect(clipboardText).toContain('Privacy: form values, event handlers, page markup, and stylesheet source are excluded')
    expect(clipboardText).toContain('?mode=test')
    expect(clipboardText).not.toContain('#fragment')
    expect(clipboardText).not.toContain('internal-secret')

    const fixtureClicks = await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
      return page?.executeJavaScript('window.fixtureClicks')
    })
    expect(fixtureClicks).toBe(0)

    const agentClickWhilePicking = await client.callTool({
      name: 'browser_click',
      arguments: { tabId: mcpTabId, selector: '#save-profile' }
    }) as CallToolResult
    expect(agentClickWhilePicking.isError, mcpResultText(agentClickWhilePicking)).not.toBe(true)
    await expect(appWindow.getByRole('button', { name: 'Cancel element selection' })).toBeVisible()
    await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
      return page?.executeJavaScript('window.fixtureClicks')
    })).toBe(1)
    await appWindow.keyboard.press('Escape')
    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
    await expect(pageTools.getByRole('button', { name: 'Select an element to copy for agent' })).toBeVisible()
    await pageTools.getByRole('button', { name: 'Close page tools' }).click()
    await expect
      .poll(() => electronApp.evaluate(async ({ webContents }) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
        return page?.executeJavaScript(`Boolean(document.querySelector('[data-hronaut-element-picker="overlay"]'))`)
      }))
      .toBe(false)
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
      await page?.executeJavaScript('window.fixtureClicks = 0')
    })

    const activeTabId = await appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active).id)')
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(activeTabId)}, true)`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(activeTabId)})?.humanInteractionLocked)`)).toBe(true)
    await electronApp.evaluate(({ clipboard }) => clipboard.clear())

    const agentScroll = await client.callTool({
      name: 'browser_scroll',
      arguments: { tabId: mcpTabId, deltaY: 600 }
    }) as CallToolResult
    expect(agentScroll.isError, mcpResultText(agentScroll)).not.toBe(true)
    await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
      return page?.executeJavaScript('window.scrollY')
    })).toBeGreaterThan(0)
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
      await page?.executeJavaScript('scrollTo(0, 0)')
      page?.sendInputEvent({ type: 'mouseWheel', x: 260, y: 220, deltaY: -600, canScroll: true })
    })
    await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
      return page?.executeJavaScript('window.scrollY')
    })).toBe(0)

    const lockedPicker = appWindow.getByRole('button', { name: 'Select an element to copy for agent' })
    await lockedPicker.click()
    await expect(appWindow.getByRole('button', { name: 'Cancel element selection' })).toBeVisible()
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
      if (!page) throw new Error('Locked picker fixture web contents was not found')
      await page.executeJavaScript('window.__hronautElementPicker.nativeInput = () => false; true')
      page.focus()
      page.sendInputEvent({ type: 'mouseMove', x: 40, y: 30, movementX: 0, movementY: 0 })
      page.sendInputEvent({ type: 'mouseDown', x: 40, y: 30, button: 'left', clickCount: 1 })
      page.sendInputEvent({ type: 'mouseUp', x: 40, y: 30, button: 'left', clickCount: 1 })
    })
    await expect(appWindow.getByRole('button', { name: 'Element copied for agent' })).toBeVisible()
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain('Selector: #save-profile')
    expect(await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
      return page?.executeJavaScript('window.fixtureClicks')
    })).toBe(0)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(activeTabId)})?.humanInteractionLocked)`)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 1_600))
    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    pageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
    await pageTools.getByRole('button', { name: 'Select an element and copy its screenshot' }).click()
    await expect(appWindow.getByRole('button', { name: 'Cancel element screenshot selection' })).toBeVisible()
    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
      if (!page) throw new Error('Locked element screenshot fixture web contents was not found')
      page.focus()
      page.sendInputEvent({ type: 'mouseMove', x: 40, y: 30, movementX: 0, movementY: 0 })
      page.sendInputEvent({ type: 'mouseDown', x: 40, y: 30, button: 'left', clickCount: 1 })
      page.sendInputEvent({ type: 'mouseUp', x: 40, y: 30, button: 'left', clickCount: 1 })
    })
    await expect(appWindow.getByRole('button', { name: 'Element screenshot copied — paste it into agent chat' })).toBeVisible()
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readImage().getSize())).toEqual({ width: 140, height: 44 })
    expect(await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
      return page?.executeJavaScript('window.fixtureClicks')
    })).toBe(0)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(activeTabId)})?.humanInteractionLocked)`)).toBe(true)
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(activeTabId)}, false)`)

    await new Promise((resolve) => setTimeout(resolve, 1_600))
    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
      if (!page) throw new Error('Picker shortcut fixture web contents was not found')
      page.focus()
      const modifiers = process.platform === 'darwin' ? ['meta', 'alt'] as const : ['control', 'shift'] as const
      page.sendInputEvent({ type: 'keyDown', keyCode: 'C', modifiers: [...modifiers] })
      page.sendInputEvent({ type: 'keyUp', keyCode: 'C', modifiers: [...modifiers] })
    })
    await expect(appWindow.getByRole('button', { name: 'Cancel element selection' })).toBeVisible()
    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/picker?mode=test'))
      if (!page) throw new Error('Picker shortcut fixture web contents disappeared before cancellation')
      page.focus()
      const modifiers = process.platform === 'darwin' ? ['meta', 'alt'] as const : ['control', 'shift'] as const
      page.sendInputEvent({ type: 'keyDown', keyCode: 'C', modifiers: [...modifiers] })
      page.sendInputEvent({ type: 'keyUp', keyCode: 'C', modifiers: [...modifiers] })
    })
    await expect(appWindow.getByRole('button', { name: 'Select an element to copy for agent' })).toBeVisible()
  } finally {
    await client.close().catch(() => undefined)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('drags a page area and copies the screenshot image for agent chat', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html>
      <title>Area capture fixture</title>
      <style>html,body{margin:0;width:100%;min-height:1800px;background:#16324f} #target{margin:40px;width:240px;height:120px;background:#ffcc66}</style>
      <div id="target" onclick="window.fixtureClicks += 1">Capture this issue</div>
      <script>
        window.fixtureClicks = 0;
        window.fixtureKeys = 0;
        window.blockPointerEvents = false;
        window.changePageAfterSelection = false;
        document.addEventListener('keydown', () => window.fixtureKeys += 1);
        document.addEventListener('pointerup', () => {
          if (!window.changePageAfterSelection) return;
          window.changePageAfterSelection = false;
          queueMicrotask(() => {
            history.pushState({}, '', '/area-capture?changed=during-selection');
            document.querySelector('#target').textContent = 'Changed while capturing';
            document.querySelector('#target').style.background = '#7ce3b1';
          });
        }, true);
        for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
          document.addEventListener(type, (event) => {
            if (!window.blockPointerEvents) return;
            event.preventDefault();
            event.stopImmediatePropagation();
          }, true);
        }
      </script>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const client = new Client({ name: 'hronaut-human-area-capture-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Area capture fixture did not expose a TCP port')
    const url = `http://127.0.0.1:${address.port}/area-capture`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect
      .poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.url)'))
      .toContain('/area-capture')

    const capture = appWindow.getByRole('button', { name: 'Capture an area to the clipboard' })
    await expect(capture).toBeEnabled()
    await capture.click()
    await expect(appWindow.getByRole('button', { name: 'Cancel area screenshot' })).toBeVisible()
    await expect
      .poll(() => electronApp.evaluate(async ({ webContents }) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
        return page?.executeJavaScript(`Boolean(document.querySelector('[data-hronaut-screenshot-area="shade"]'))`)
      }))
      .toBe(true)

    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
      if (!page) throw new Error('Area capture fixture web contents was not found')
      await page.executeJavaScript(`(() => {
        const fire = (type, x, y, buttons) => document.querySelector('#target').dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons,
          clientX: x, clientY: y
        }));
        fire('pointerdown', 50, 50, 1);
        fire('pointermove', 230, 140, 1);
        fire('pointerup', 230, 140, 0);
      })()`)
    })

    await expect(appWindow.getByRole('button', { name: 'Area screenshot copied — paste it into agent chat' })).toBeVisible()
    const captureToast = appWindow.getByRole('status', { name: 'Area screenshot copied' })
    await expect(captureToast).toContainText('Paste the PNG into your agent chat.')
    const captureFeedbackPlacement = await appWindow.locator('.address-form').evaluate((address) => {
      const toast = address.ownerDocument.querySelector('.app-toast')
      const shell = address.ownerDocument.querySelector('.shell')
      const toastBounds = toast?.getBoundingClientRect()
      const shellBounds = shell?.getBoundingClientRect()
      return {
        insideAddress: Boolean(toast && address.contains(toast)),
        toolbarOverflow: address.closest('.toolbar')!.scrollWidth - address.closest('.toolbar')!.clientWidth,
        topWindowOverlay: Boolean(toastBounds && shellBounds
          && toastBounds.top <= 8
          && toastBounds.bottom <= shellBounds.bottom)
      }
    })
    expect(captureFeedbackPlacement).toEqual({ insideAddress: false, toolbarOverflow: 0, topWindowOverlay: true })
    const clipboardImage = await electronApp.evaluate(({ clipboard }) => {
      const image = clipboard.readImage()
      return { empty: image.isEmpty(), size: image.getSize(), pngBytes: image.toPNG().byteLength }
    })
    expect(clipboardImage).toEqual({ empty: false, size: { width: 180, height: 90 }, pngBytes: expect.any(Number) })
    expect(clipboardImage.pngBytes).toBeGreaterThan(100)

    await expect
      .poll(() => electronApp.evaluate(async ({ webContents }) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
        return page?.executeJavaScript(`Boolean(document.querySelector('[data-hronaut-screenshot-area]'))`)
      }))
      .toBe(false)

    await expect(capture).toBeVisible({ timeout: 4_000 })
    await electronApp.evaluate(async ({ clipboard, webContents }) => {
      clipboard.clear()
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
      if (!page) throw new Error('Changing area capture fixture web contents was not found')
      await page.executeJavaScript('window.changePageAfterSelection = true')
    })
    await capture.click()
    await expect(appWindow.getByRole('button', { name: 'Cancel area screenshot' })).toBeVisible()
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
      if (!page) throw new Error('Changing area capture fixture web contents disappeared')
      await page.executeJavaScript(`(() => {
        const fire = (type, x, y, buttons) => document.querySelector('#target').dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true, pointerId: 2, pointerType: 'mouse', button: 0, buttons,
          clientX: x, clientY: y
        }));
        fire('pointerdown', 55, 55, 1);
        fire('pointermove', 225, 135, 1);
        fire('pointerup', 225, 135, 0);
      })()`)
    })
    await expect(appWindow.getByRole('button', { name: 'Area screenshot copied — paste it into agent chat' })).toBeVisible()
    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))?.getURL()
    ))).toContain('changed=during-selection')
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readImage().getSize())).toEqual({ width: 170, height: 80 })

    await expect(appWindow.getByRole('button', { name: 'Capture an area to the clipboard' })).toBeVisible({ timeout: 4_000 })
    const activeTabId = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.activeTabId)`)
    if (typeof activeTabId !== 'string') throw new Error('Area capture fixture did not have an active tab')
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(activeTabId)}, true)`)
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
      await page?.executeJavaScript('window.blockPointerEvents = true')
    })

    await capture.click()
    await expect(appWindow.getByRole('button', { name: 'Cancel area screenshot' })).toBeVisible()
    await expect
      .poll(() => electronApp.evaluate(async ({ webContents }) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
        return page?.executeJavaScript(`Boolean(document.querySelector('[data-hronaut-screenshot-area="shade"]'))`)
      }))
      .toBe(true)
    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
      if (!page) throw new Error('Locked area capture fixture web contents was not found')
      page.focus()
      page.sendInputEvent({ type: 'mouseMove', x: 60, y: 60, movementX: 0, movementY: 0 })
      page.sendInputEvent({ type: 'mouseDown', x: 60, y: 60, button: 'left', clickCount: 1 })
      page.sendInputEvent({ type: 'mouseMove', x: 220, y: 140, movementX: 160, movementY: 80 })
      page.sendInputEvent({ type: 'mouseWheel', x: 220, y: 140, deltaY: 320, canScroll: true })
    })
    await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
      if (!page) return null
      return page.executeJavaScript(`(() => {
        const selection = document.querySelector('[data-hronaut-screenshot-area="selection"]');
        return selection ? { display: getComputedStyle(selection).display, width: selection.style.width, height: selection.style.height } : null;
      })()`)
    })).toEqual({ display: 'block', width: '160px', height: '80px' })
    expect(await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
      return page?.executeJavaScript('scrollY')
    })).toBe(0)
    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
      if (!page) throw new Error('Locked area capture fixture web contents disappeared before release')
      page.sendInputEvent({ type: 'mouseUp', x: 220, y: 140, button: 'left', clickCount: 1 })
    })

    await expect(appWindow.getByRole('button', { name: 'Area screenshot copied — paste it into agent chat' })).toBeVisible()
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readImage().getSize())).toEqual({ width: 160, height: 80 })
    expect(await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
      return page?.executeJavaScript('window.fixtureClicks')
    })).toBe(0)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(activeTabId)})?.humanInteractionLocked)`)).toBe(true)

    await expect(appWindow.getByRole('button', { name: 'Capture an area to the clipboard' })).toBeVisible({ timeout: 4_000 })
    await capture.click()
    await expect(appWindow.getByRole('button', { name: 'Cancel area screenshot' })).toBeVisible()
    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
      if (!page) throw new Error('Locked area capture fixture web contents was not found for cancellation')
      page.focus()
      page.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      page.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    })
    await expect(appWindow.getByRole('button', { name: 'Capture an area to the clipboard' })).toBeVisible()
    expect(await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
      return page?.executeJavaScript('window.fixtureKeys')
    })).toBe(0)

    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(activeTabId)}, false)`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(activeTabId)})?.humanInteractionLocked)`)).toBe(false)
    await electronApp.evaluate(({ clipboard }) => clipboard.clear())

    await capture.click()
    await expect(appWindow.getByRole('button', { name: 'Cancel area screenshot' })).toBeVisible()
    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
      if (!page) throw new Error('Unlocked area capture fixture web contents was not found')
      page.focus()
      page.sendInputEvent({ type: 'mouseMove', x: 70, y: 65, movementX: 0, movementY: 0 })
      page.sendInputEvent({ type: 'mouseDown', x: 70, y: 65, button: 'left', clickCount: 1 })
      page.sendInputEvent({ type: 'mouseMove', x: 250, y: 155, movementX: 180, movementY: 90 })
      page.sendInputEvent({ type: 'mouseUp', x: 250, y: 155, button: 'left', clickCount: 1 })
    })

    await expect(appWindow.getByRole('button', { name: 'Area screenshot copied — paste it into agent chat' })).toBeVisible()
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(await electronApp.evaluate(({ clipboard }) => {
      const image = clipboard.readImage()
      return { empty: image.isEmpty(), size: image.getSize(), formats: clipboard.availableFormats() }
    })).toEqual({
      empty: false,
      size: { width: 180, height: 90 },
      formats: expect.arrayContaining(['image/png'])
    })
    const externalClipboard = await execFileAsync(
      join(process.cwd(), 'node_modules/electron/dist/electron'),
      ['--no-sandbox', join(process.cwd(), 'tests/integration/clipboard-reader.cjs')],
      { env: process.env, timeout: 8_000 }
    )
    expect(JSON.parse(externalClipboard.stdout.trim())).toMatchObject({
      empty: false,
      width: 180,
      height: 90,
      hasPng: true
    })

    await expect(appWindow.getByRole('button', { name: 'Capture an area to the clipboard' })).toBeVisible({ timeout: 4_000 })
    await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(activeTabId)})`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(activeTabId)})?.devToolsOpen)`)).toBe(true)
    await electronApp.evaluate(({ clipboard }) => clipboard.clear())
    await capture.click()
    await expect(appWindow.getByRole('button', { name: 'Cancel area screenshot' })).toBeVisible()
    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture'))
      if (!page) throw new Error('DevTools area capture fixture web contents was not found')
      page.focus()
      page.sendInputEvent({ type: 'mouseMove', x: 80, y: 70, movementX: 0, movementY: 0 })
      page.sendInputEvent({ type: 'mouseDown', x: 80, y: 70, button: 'left', clickCount: 1 })
      page.sendInputEvent({ type: 'mouseMove', x: 220, y: 140, movementX: 140, movementY: 70 })
      page.sendInputEvent({ type: 'mouseUp', x: 220, y: 140, button: 'left', clickCount: 1 })
    })
    await expect(appWindow.getByRole('button', { name: 'Area screenshot copied — paste it into agent chat' })).toBeVisible()
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readImage().getSize())).toEqual({ width: 140, height: 70 })
    await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(activeTabId)})`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(activeTabId)})?.devToolsOpen)`)).toBe(false)

    await client.connect(transport)
    await useMcpWorkspace(client, 'Human area capture tests', false)
    const mcpUrl = `${url}?created=mcp`
    const opened = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: mcpUrl, active: true }
    }) as CallToolResult
    expect(opened.isError, mcpResultText(opened)).not.toBe(true)
    const mcpTabId = (JSON.parse(mcpResultText(opened)) as { activeTabId: string }).activeTabId
    const ready = await client.callTool({ name: 'browser_wait', arguments: { tabId: mcpTabId } }) as CallToolResult
    expect(ready.isError, mcpResultText(ready)).not.toBe(true)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(mcpTabId)
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(mcpTabId)}, true)`)
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture?created=mcp'))
      if (!page) throw new Error('MCP-created area capture fixture web contents was not found')
      await page.executeJavaScript('window.blockPointerEvents = true')
    })

    await expect(capture).toBeEnabled()
    await electronApp.evaluate(({ clipboard }) => clipboard.clear())
    await capture.click()
    await expect(appWindow.getByRole('button', { name: 'Cancel area screenshot' })).toBeVisible()
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('/area-capture?created=mcp'))
      if (!page) throw new Error('MCP-created area capture fixture disappeared')
      await page.executeJavaScript(`(() => {
        document.querySelector('#target').textContent = 'Changed while selecting';
        document.querySelector('#target').style.background = '#7ce3b1';
        window.__hronautScreenshotArea.nativeInput = () => false;
      })()`)
      page.focus()
      page.sendInputEvent({ type: 'mouseMove', x: 90, y: 75, movementX: 0, movementY: 0 })
      page.sendInputEvent({ type: 'mouseDown', x: 90, y: 75, button: 'left', clickCount: 1 })
      page.sendInputEvent({ type: 'mouseMove', x: 240, y: 150, movementX: 150, movementY: 75 })
      page.sendInputEvent({ type: 'mouseUp', x: 240, y: 150, button: 'left', clickCount: 1 })
    })
    await expect(appWindow.getByRole('button', { name: 'Area screenshot copied — paste it into agent chat' })).toBeVisible()
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readImage().getSize())).toEqual({ width: 150, height: 75 })
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(mcpTabId)})?.humanInteractionLocked)`)).toBe(true)

    await appWindow.getByRole('button', { name: 'Open command palette' }).click()
    const palette = appWindow.getByRole('dialog', { name: 'Commands' })
    await palette.getByRole('combobox', { name: 'Search commands' }).fill('entire long screenshot')
    await palette.getByRole('option', { name: /Capture full-page screenshot/ }).click()
    await expect(appWindow.getByRole('button', { name: 'Full-page screenshot copied — paste it into agent chat' })).toBeVisible()
    const fullPageSize = await electronApp.evaluate(({ clipboard }) => clipboard.readImage().getSize())
    expect(fullPageSize.height).toBeGreaterThanOrEqual(1_800)
    expect(fullPageSize.width).toBeGreaterThan(0)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(mcpTabId)})?.humanInteractionLocked)`)).toBe(true)
  } finally {
    await client.close().catch(() => undefined)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('shows typed agent setup, connection activity, and the live tool catalog on Home', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken
}) => {
  await expect
    .poll(() =>
      electronApp.evaluate(async ({ webContents }) => {
        const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
        return home?.getTitle()
      })
    )
    .toBe('Hronaut Home')

  const homeContent = await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return home.executeJavaScript(`(() => {
      document.querySelector('[data-guide="opencode"]')?.click();
      const result = {
        heading: document.querySelector('h1')?.textContent,
        agents: [...document.querySelectorAll('[data-guide]')].map((node) => node.textContent),
        tools: document.querySelectorAll('.tool').length,
        activeCount: document.getElementById('active-count')?.textContent,
        requestCount: document.getElementById('request-count')?.textContent,
        verifyCommand: document.getElementById('guide-verify-command')?.textContent,
        verifyHidden: document.getElementById('guide-verify')?.hidden,
        geminiConfig: null,
        kiloConfig: null,
        kiloVerifyCommand: null,
        junieConfig: null,
        junieVerifyCommand: null,
        devinConfig: null,
        devinVerifyCommand: null,
        zedConfig: null,
        zedVerifyCommand: null
      };
      document.querySelector('[data-guide="gemini-cli"]')?.click();
      result.geminiConfig = JSON.parse(document.getElementById('guide-code')?.textContent ?? '{}');
      document.querySelector('[data-guide="kilo"]')?.click();
      result.kiloConfig = JSON.parse(document.getElementById('guide-code')?.textContent ?? '{}');
      result.kiloVerifyCommand = document.getElementById('guide-verify-command')?.textContent;
      document.querySelector('[data-guide="jetbrains-junie"]')?.click();
      result.junieConfig = JSON.parse(document.getElementById('guide-code')?.textContent ?? '{}');
      result.junieVerifyCommand = document.getElementById('guide-verify-command')?.textContent;
      document.querySelector('[data-guide="devin-local"]')?.click();
      result.devinConfig = JSON.parse(document.getElementById('guide-code')?.textContent ?? '{}');
      result.devinVerifyCommand = document.getElementById('guide-verify-command')?.textContent;
      document.querySelector('[data-guide="zed"]')?.click();
      result.zedConfig = JSON.parse(document.getElementById('guide-code')?.textContent ?? '{}');
      result.zedVerifyCommand = document.getElementById('guide-verify-command')?.textContent;
      return result;
    })()`)
  }) as {
    heading: string
    agents: string[]
    tools: number
    activeCount: string
    requestCount: string
    verifyCommand: string
    verifyHidden: boolean
    geminiConfig: {
      mcpServers?: {
        hronaut?: {
          httpUrl?: string
          url?: string
          type?: string
          headers?: { Authorization?: string }
        }
      }
    }
    kiloConfig: {
      mcp?: {
        hronaut?: {
          type?: string
          url?: string
          enabled?: boolean
          oauth?: boolean
          headers?: { Authorization?: string }
        }
      }
    }
    kiloVerifyCommand: string
    junieConfig: {
      mcpServers?: {
        hronaut?: {
          url?: string
          headers?: { Authorization?: string }
        }
      }
    }
    junieVerifyCommand: string
    devinConfig: {
      mcpServers?: {
        hronaut?: {
          url?: string
          transport?: string
          headers?: { Authorization?: string }
        }
      }
    }
    devinVerifyCommand: string
    zedConfig: {
      context_servers?: {
        hronaut?: {
          url?: string
          headers?: { Authorization?: string }
        }
      }
    }
    zedVerifyCommand: string
  }
  expect(homeContent.heading).toBe('Your browser, ready for coding agents.')
  expect(homeContent.agents).toEqual(['Codex', 'Claude Code', 'Cursor', 'VS Code / Copilot', 'OpenCode', 'Gemini CLI', 'Cline', 'Kiro', 'Kilo Code', 'JetBrains Junie', 'Devin Local', 'Zed', 'Mistral Vibe', 'Warp', 'Generic MCP client'])
  expect(homeContent.tools).toBe(BROWSER_TOOL_CATALOG.length)
  expect(homeContent.activeCount).toBe('0 active')
  expect(homeContent.requestCount).toBe('Waiting for the first tool call')
  expect(homeContent.verifyCommand).toBe('opencode mcp list')
  expect(homeContent.verifyHidden).toBe(false)
  expect(homeContent.geminiConfig.mcpServers?.hronaut).toEqual({
    httpUrl: `http://127.0.0.1:${mcpPort}/mcp`
  })
  expect(homeContent.kiloConfig.mcp?.hronaut).toEqual({
    type: 'remote',
    url: `http://127.0.0.1:${mcpPort}/mcp`,
    enabled: true,
    oauth: false
  })
  expect(homeContent.kiloVerifyCommand).toBe('kilo mcp list')
  expect(homeContent.junieConfig.mcpServers?.hronaut).toEqual({
    url: `http://127.0.0.1:${mcpPort}/mcp`
  })
  expect(homeContent.junieVerifyCommand).toBe('/mcp')
  expect(homeContent.devinConfig.mcpServers?.hronaut).toEqual({
    url: `http://127.0.0.1:${mcpPort}/mcp`,
    transport: 'http'
  })
  expect(homeContent.devinVerifyCommand).toBe('devin mcp list && devin mcp get hronaut')
  expect(homeContent.zedConfig.context_servers?.hronaut).toEqual({
    url: `http://127.0.0.1:${mcpPort}/mcp`,
    headers: { Authorization: 'Hronaut local-no-auth' }
  })
  expect(homeContent.zedVerifyCommand).toBe('Settings → AI → MCP Servers: Server is active')

  const initial = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${mcpToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'hronaut-integration', version: '1.0.0' }
      }
    })
  })
  expect(initial.ok).toBe(true)
  const initialization = await initial.json() as {
    result?: { instructions?: string }
  }
  expect(initialization.result?.instructions).toContain('create a fresh isolated workspace')
  expect(initialization.result?.instructions).toContain('browser_snapshot')
  expect(initialization.result?.instructions).toContain('browser_request_user_attention')
  expect(initialization.result?.instructions).toContain('persist after this MCP client disconnects')

  await expect
    .poll(() =>
      electronApp.evaluate(async ({ webContents }) => {
        const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
        if (!home) return null
        return home.executeJavaScript(`fetch('/api/status').then((response) => response.json())`)
      })
    )
    .toMatchObject({
      name: 'hronaut',
      totalRequests: 1,
      tools: expect.arrayContaining([expect.objectContaining({ name: 'browser_navigate' })]),
      clients: expect.arrayContaining([expect.objectContaining({ name: 'hronaut-integration', version: '1.0.0' })])
    })

  await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) return null
    return home.executeJavaScript(`({
      activeCount: document.getElementById('active-count')?.textContent,
      requestCount: document.getElementById('request-count')?.textContent
    })`)
  })).toEqual({ activeCount: '0 active', requestCount: '1 MCP request handled' })

  await appWindow.getByRole('button', { name: 'Pause agents' }).click()
  await expect(appWindow.getByRole('button', { name: 'Resume agents' })).toBeVisible()
  const pausedResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${mcpToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'paused-test', version: '1.0.0' } } })
  })
  expect(pausedResponse.status).toBe(503)
  await expect(pausedResponse.json()).resolves.toEqual({
    error: 'Hronaut is paused by the user. Resume agents from the Hronaut window.'
  })
  const pausedDashboard = await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    return home?.executeJavaScript(`fetch('/api/status').then((response) => response.json())`)
  }) as { paused: boolean; status: string }
  expect(pausedDashboard.paused).toBe(true)
  expect(pausedDashboard.status).toBe('paused')

  await appWindow.getByRole('button', { name: 'Resume agents' }).click()
  await expect(appWindow.getByRole('button', { name: 'Pause agents' })).toBeVisible()
  await expect.poll(() => appWindow.evaluate('window.hronautMcp.getState()')).toMatchObject({ status: 'ready', paused: false })
  const resumed = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${mcpToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'resumed-test', version: '1.0.0' } } })
  })
  expect(resumed.ok).toBe(true)
})

test('controls whether bounded diagnostic logs survive page navigation', async ({ appWindow }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    const marker = request.url === '/first' ? 'before-navigation-marker' : request.url === '/second' ? 'after-navigation-marker' : 'preserved-navigation-marker'
    response.end(`<!doctype html><title>${marker}</title><script>console.error(${JSON.stringify(marker)})</script>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Diagnostic log test server did not expose a port')
    const baseUrl = `http://127.0.0.1:${address.port}`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${baseUrl}/first`)}, active: true })`)
    const tabId = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.activeTabId)`) as string
    await expect.poll(() => appWindow.evaluate(`window.hronaut.createDebugReport({ tabId: ${JSON.stringify(tabId)}, includeSuccessfulRequests: true })`)).toMatchObject({
      console: expect.arrayContaining([expect.objectContaining({ message: 'before-navigation-marker' })])
    })

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: 'Open network monitor' }).click()
    const networkPanel = appWindow.getByRole('dialog', { name: 'Network' })
    const preserveToggle = networkPanel.getByLabel('Preserve logs')
    await expect(preserveToggle).toBeChecked()
    await preserveToggle.uncheck()
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.preserveDiagnosticLogs)`)).toBe(false)

    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(tabId)}, url: ${JSON.stringify(`${baseUrl}/second`)} })`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.createDebugReport({ tabId: ${JSON.stringify(tabId)}, includeSuccessfulRequests: true })`)).toMatchObject({
      console: expect.arrayContaining([expect.objectContaining({ message: 'after-navigation-marker' })])
    })
    const isolatedReport = await appWindow.evaluate(`window.hronaut.createDebugReport({ tabId: ${JSON.stringify(tabId)}, includeSuccessfulRequests: true })`) as { console: Array<{ message: string }>; network: Array<{ url: string }> }
    expect(isolatedReport.console.some((message) => message.message.includes('before-navigation-marker'))).toBe(false)
    expect(isolatedReport.network.some((request) => request.url.includes('/first'))).toBe(false)
    expect(isolatedReport.network.some((request) => request.url.includes('/second'))).toBe(true)

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: 'Open network monitor' }).click()
    await appWindow.getByRole('dialog', { name: 'Network' }).getByLabel('Preserve logs').check()
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(tabId)}, url: ${JSON.stringify(`${baseUrl}/third`)} })`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.createDebugReport({ tabId: ${JSON.stringify(tabId)}, includeSuccessfulRequests: true })`)).toMatchObject({
      console: expect.arrayContaining([
        expect.objectContaining({ message: 'after-navigation-marker' }),
        expect.objectContaining({ message: 'preserved-navigation-marker' })
      ])
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('quits cleanly while a tab navigation is still active', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Delayed page</title>')
    }, 500)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port')
    await appWindow.evaluate(
      `window.hronaut.newTab({ url: ${JSON.stringify(`http://127.0.0.1:${address.port}/slow`)}, active: true })`
    )
    await expect
      .poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.some((tab) => tab.loading))'))
      .toBe(true)

    const child = electronApp.process()
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve))
    await appWindow.evaluate('setTimeout(() => window.hronaut.quit(), 0)')
    await expect(exited).resolves.toBe(0)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
