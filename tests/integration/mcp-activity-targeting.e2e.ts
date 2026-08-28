import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

async function connectMcpClient(mcpPort: number, mcpToken: string, name: string): Promise<Client> {
  const authorization = `Bearer ${mcpToken}`
  await expect.poll(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization } })).ok
    } catch {
      return false
    }
  }).toBe(true)
  const client = new Client({ name, version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization } }
  }))
  return client
}

async function createWorkspace(client: Client, name: string): Promise<string> {
  const result = await client.callTool({
    name: 'browser_workspaces',
    arguments: { action: 'create', name }
  }) as CallToolResult
  expect(result.isError, text(result)).not.toBe(true)
  return (JSON.parse(text(result)) as { id: string }).id
}

async function startPageServer(title: string, body: string): Promise<{
  server: ReturnType<typeof createServer>
  url: string
}> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>${title}</title><main>${body}</main>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Page fixture did not expose a port')
  return { server, url: `http://127.0.0.1:${address.port}/` }
}

test('attributes omitted-tab activity only to the validated workspace target', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Activity target</title><main>Activity target ready</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const authorization = `Bearer ${mcpToken}`
  const client = new Client({ name: 'hronaut-activity-targeting-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization } }
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Activity fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/activity-target`
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization } })).ok
      } catch {
        return false
      }
    }).toBe(true)
    await client.connect(transport)
    const firstWorkspace = await client.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'create', name: 'Activity target workspace' }
    }) as CallToolResult
    const firstWorkspaceId = (JSON.parse(text(firstWorkspace)) as { id: string }).id
    const secondWorkspace = await client.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'create', name: 'Activity peer workspace' }
    }) as CallToolResult
    const secondWorkspaceId = (JSON.parse(text(secondWorkspace)) as { id: string }).id
    const opened = await client.callTool({
      name: 'browser_new_tab',
      arguments: { workspaceId: firstWorkspaceId, url, active: true }
    }) as CallToolResult
    const targetTabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
    await client.callTool({
      name: 'browser_wait',
      arguments: { workspaceId: firstWorkspaceId, tabId: targetTabId, text: 'Activity target ready' }
    })
    await client.callTool({
      name: 'browser_new_tab',
      arguments: { workspaceId: secondWorkspaceId, url: 'about:blank', active: false }
    })
    await appWindow.evaluate('window.hronaut.openHome()')
    await expect(appWindow.locator('[role="tab"][data-mcp-command]')).toHaveCount(0)
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(targetTabId)}, true)`)

    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))
      if (!page) throw new Error('Sleeping activity target WebContents was not found')
      const originalRestore = page.navigationHistory.restore.bind(page.navigationHistory)
      const control = {
        pageId: page.id,
        restore: originalRestore,
        started: false,
        release: undefined as (() => void) | undefined
      }
      ;(globalThis as typeof globalThis & { __hronautDelayedMcpActivityWake?: typeof control }).__hronautDelayedMcpActivityWake = control
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async (...args: Parameters<typeof originalRestore>) => {
          control.started = true
          await new Promise<void>((resolve) => { control.release = resolve })
          return originalRestore(...args)
        }
      })
    })

    const waiting = client.callTool({
      name: 'browser_wait',
      arguments: { workspaceId: firstWorkspaceId, text: 'Activity target ready', timeoutMs: 5_000 }
    }) as Promise<CallToolResult>
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautDelayedMcpActivityWake?: { started: boolean } })
        .__hronautDelayedMcpActivityWake?.started ?? false
    ))).toBe(true)
    await expect(appWindow.locator(`[role="tab"][data-tab-id="${targetTabId}"]`)).toHaveAttribute('data-mcp-command', 'browser_wait')
    await expect(appWindow.locator('[role="tab"][data-mcp-command="browser_wait"]')).toHaveCount(1)

    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __hronautDelayedMcpActivityWake?: { release?: () => void }
      }).__hronautDelayedMcpActivityWake
      if (!control?.release) throw new Error('Delayed MCP activity wake was not waiting')
      control.release()
    })
    const waited = await waiting
    expect(waited.isError, text(waited)).not.toBe(true)

    await appWindow.evaluate('window.hronaut.openHome()')
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(targetTabId)}, true)`)
    const rejected = await client.callTool({
      name: 'browser_snapshot',
      arguments: { workspaceId: secondWorkspaceId, tabId: targetTabId }
    }) as CallToolResult
    expect(rejected.isError).toBe(true)
    expect(text(rejected)).toContain('does not belong to workspace')
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
      state.tabs.find((tab) => tab.id === ${JSON.stringify(targetTabId)})?.sleeping
    ))`)).toBe(true)
    await expect(appWindow.locator(`[role="tab"][data-tab-id="${targetTabId}"]`)).not.toHaveAttribute('data-mcp-command')
  } finally {
    await electronApp.evaluate(({ webContents }) => {
      const scope = globalThis as typeof globalThis & {
        __hronautDelayedMcpActivityWake?: { pageId: number; restore: Electron.NavigationHistory['restore']; release?: () => void }
      }
      scope.__hronautDelayedMcpActivityWake?.release?.()
      const control = scope.__hronautDelayedMcpActivityWake
      const page = control ? webContents.fromId(control.pageId) : undefined
      if (control && page) {
        Object.defineProperty(page.navigationHistory, 'restore', { configurable: true, value: control.restore })
      }
      delete scope.__hronautDelayedMcpActivityWake
    }).catch(() => undefined)
    try {
      await client.close()
    } catch {
      // A failed assertion can close Electron while the delayed MCP request is settling.
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('keeps a newer human selection authoritative while MCP wakes a sleeping selected tab', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken
}) => {
  const fixture = await startPageServer('MCP delayed selection', 'Target ready')
  const client = await connectMcpClient(mcpPort, mcpToken, 'hronaut-select-authority-test')
  try {
    const workspaceId = await createWorkspace(client, 'MCP select authority')
    const openedTarget = await client.callTool({
      name: 'browser_new_tab',
      arguments: {
        workspaceId,
        url: fixture.url,
        active: true
      }
    }) as CallToolResult
    expect(openedTarget.isError, text(openedTarget)).not.toBe(true)
    const targetTabId = (JSON.parse(text(openedTarget)) as { activeTabId: string }).activeTabId
    const waited = await client.callTool({
      name: 'browser_wait',
      arguments: { workspaceId, tabId: targetTabId, text: 'Target ready' }
    }) as CallToolResult
    expect(waited.isError, text(waited)).not.toBe(true)

    const fallbackTabId = await appWindow.evaluate(`window.hronaut.newTab({
      url: 'data:text/html,<title>Human selection fallback</title><main>Fallback ready</main>',
      active: true,
      mcpGroupId: ${JSON.stringify(workspaceId)}
    }).then((state) => state.activeTabId)`) as string
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(targetTabId)}, true)`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
      state.tabs.find((tab) => tab.id === ${JSON.stringify(targetTabId)})?.sleeping
    ))`)).toBe(true)

    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))
      if (!page) throw new Error('Sleeping MCP selection WebContents was not found')
      const originalRestore = page.navigationHistory.restore.bind(page.navigationHistory)
      const control = {
        pageId: page.id,
        restore: originalRestore,
        started: false,
        release: undefined as (() => void) | undefined
      }
      ;(globalThis as typeof globalThis & { __hronautDelayedMcpSelectionWake?: typeof control })
        .__hronautDelayedMcpSelectionWake = control
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async (...args: Parameters<typeof originalRestore>) => {
          control.started = true
          await new Promise<void>((resolve) => { control.release = resolve })
          return originalRestore(...args)
        }
      })
    })

    const selecting = client.callTool({
      name: 'browser_select_tab',
      arguments: { workspaceId, tabId: targetTabId }
    }) as Promise<CallToolResult>
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautDelayedMcpSelectionWake?: { started: boolean } })
        .__hronautDelayedMcpSelectionWake?.started ?? false
    ))).toBe(true)

    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(fallbackTabId)})`)
    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __hronautDelayedMcpSelectionWake?: { release?: () => void }
      }).__hronautDelayedMcpSelectionWake
      if (!control?.release) throw new Error('Delayed MCP selection wake was not waiting')
      control.release()
    })
    const selected = await selecting
    expect(selected.isError, text(selected)).not.toBe(true)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)'))
      .toBe(fallbackTabId)
  } finally {
    await electronApp.evaluate(({ webContents }) => {
      const scope = globalThis as typeof globalThis & {
        __hronautDelayedMcpSelectionWake?: {
          pageId: number
          restore: Electron.NavigationHistory['restore']
          release?: () => void
        }
      }
      scope.__hronautDelayedMcpSelectionWake?.release?.()
      const control = scope.__hronautDelayedMcpSelectionWake
      const page = control ? webContents.fromId(control.pageId) : undefined
      if (control && page) {
        Object.defineProperty(page.navigationHistory, 'restore', { configurable: true, value: control.restore })
      }
      delete scope.__hronautDelayedMcpSelectionWake
    }).catch(() => undefined)
    await client.close().catch(() => undefined)
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()))
  }
})

test('closes a sleeping MCP tab without trying to wake it', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken
}) => {
  const fixture = await startPageServer('MCP sleeping close', 'Close target ready')
  const client = await connectMcpClient(mcpPort, mcpToken, 'hronaut-sleeping-close-test')
  try {
    const workspaceId = await createWorkspace(client, 'MCP sleeping close')
    const openedTarget = await client.callTool({
      name: 'browser_new_tab',
      arguments: {
        workspaceId,
        url: fixture.url,
        active: true
      }
    }) as CallToolResult
    expect(openedTarget.isError, text(openedTarget)).not.toBe(true)
    const targetTabId = (JSON.parse(text(openedTarget)) as { activeTabId: string }).activeTabId
    const waited = await client.callTool({
      name: 'browser_wait',
      arguments: { workspaceId, tabId: targetTabId, text: 'Close target ready' }
    }) as CallToolResult
    expect(waited.isError, text(waited)).not.toBe(true)
    await appWindow.evaluate(`window.hronaut.newTab({
      url: 'about:blank',
      active: true,
      mcpGroupId: ${JSON.stringify(workspaceId)}
    })`)
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(targetTabId)}, true)`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
      state.tabs.find((tab) => tab.id === ${JSON.stringify(targetTabId)})?.sleeping
    ))`)).toBe(true)

    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))
      if (!page) throw new Error('Sleeping MCP close WebContents was not found')
      const originalRestore = page.navigationHistory.restore.bind(page.navigationHistory)
      const originalLoadUrl = page.loadURL.bind(page)
      const control = {
        pageId: page.id,
        restore: originalRestore,
        loadUrl: originalLoadUrl,
        wakeAttempts: 0
      }
      ;(globalThis as typeof globalThis & { __hronautRejectedMcpCloseWake?: typeof control })
        .__hronautRejectedMcpCloseWake = control
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async () => {
          control.wakeAttempts += 1
          throw new Error('MCP close must not restore a sleeping tab')
        }
      })
      Object.defineProperty(page, 'loadURL', {
        configurable: true,
        value: async () => {
          control.wakeAttempts += 1
          throw new Error('MCP close must not reload a sleeping tab')
        }
      })
    })

    const closed = await client.callTool({
      name: 'browser_close_tab',
      arguments: { workspaceId, tabId: targetTabId }
    }) as CallToolResult
    expect(closed.isError, text(closed)).not.toBe(true)
    expect((JSON.parse(text(closed)) as { tabs: Array<{ id: string }> }).tabs)
      .not.toContainEqual(expect.objectContaining({ id: targetTabId }))
    expect(await electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautRejectedMcpCloseWake?: { wakeAttempts: number } })
        .__hronautRejectedMcpCloseWake?.wakeAttempts ?? -1
    ))).toBe(0)
  } finally {
    await electronApp.evaluate(({ webContents }) => {
      const scope = globalThis as typeof globalThis & {
        __hronautRejectedMcpCloseWake?: {
          pageId: number
          restore: Electron.NavigationHistory['restore']
          loadUrl: Electron.WebContents['loadURL']
        }
      }
      const control = scope.__hronautRejectedMcpCloseWake
      const page = control ? webContents.fromId(control.pageId) : undefined
      if (control && page) {
        Object.defineProperty(page.navigationHistory, 'restore', { configurable: true, value: control.restore })
        Object.defineProperty(page, 'loadURL', { configurable: true, value: control.loadUrl })
      }
      delete scope.__hronautRejectedMcpCloseWake
    }).catch(() => undefined)
    await client.close().catch(() => undefined)
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()))
  }
})
