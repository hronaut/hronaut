import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserDownloadState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const result = await client.callTool({ name, arguments: args }) as CallToolResult
  expect(result.isError, text(result)).not.toBe(true)
  return result
}

async function createWorkspace(client: Client, name: string): Promise<string> {
  const result = await call(client, 'browser_workspaces', { action: 'create', name })
  return (JSON.parse(text(result)) as { id: string }).id
}

async function downloadInWorkspace(
  client: Client,
  workspaceId: string,
  url: string
): Promise<void> {
  const opened = await call(client, 'browser_new_tab', { workspaceId, url, active: true })
  const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
  await call(client, 'browser_wait', { workspaceId, tabId, selector: '#download' })
  await call(client, 'browser_click', { workspaceId, tabId, selector: '#download' })
}

test('keeps MCP download history isolated across workspace archive and restore', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken,
  profileDirectory
}) => {
  const server = createServer((request, response) => {
    const match = /^\/([^/]+)\.txt$/.exec(request.url ?? '')
    if (match) {
      response.writeHead(200, {
        'content-disposition': `attachment; filename="${match[1]}.txt"`,
        'content-type': 'text/plain'
      })
      response.end(`download from ${match[1]}`)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>Download isolation</title>
      <a id="download" href="${request.url}.txt" download>Download file</a>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const client = new Client({ name: 'mcp-download-isolation-test', version: '1.0.0' })
  try {
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, {
          headers: { authorization: `Bearer ${mcpToken}` }
        })).ok
      } catch {
        return false
      }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))

    const firstWorkspaceId = await createWorkspace(client, 'First download workspace')
    const secondWorkspaceId = await createWorkspace(client, 'Second download workspace')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Download fixture did not expose a port')

    await downloadInWorkspace(client, firstWorkspaceId, `http://127.0.0.1:${address.port}/first`)
    await downloadInWorkspace(client, secondWorkspaceId, `http://127.0.0.1:${address.port}/second`)

    await expect.poll(() => appWindow.evaluate('window.hronautDownloads.list()'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ filename: 'first.txt', state: 'completed' }),
        expect.objectContaining({ filename: 'second.txt', state: 'completed' })
      ]))

    const firstDownloads = JSON.parse(text(await call(client, 'browser_downloads', {
      workspaceId: firstWorkspaceId
    }))) as BrowserDownloadState[]
    expect(firstDownloads).toEqual([
      expect.objectContaining({
        filename: 'first.txt',
        savePath: `${profileDirectory}/first.txt`,
        state: 'completed'
      })
    ])

    const secondDownloads = JSON.parse(text(await call(client, 'browser_downloads', {
      workspaceId: secondWorkspaceId
    }))) as BrowserDownloadState[]
    expect(secondDownloads).toEqual([
      expect.objectContaining({
        filename: 'second.txt',
        savePath: `${profileDirectory}/second.txt`,
        state: 'completed'
      })
    ])

    const saved = JSON.parse(text(await call(client, 'browser_saved_workspaces', {
      action: 'save',
      workspaceId: firstWorkspaceId
    }))) as { id: string }
    const opened = JSON.parse(text(await call(client, 'browser_saved_workspaces', {
      action: 'open',
      savedWorkspaceId: saved.id
    }))) as { id: string }
    expect(opened.id).toBe(firstWorkspaceId)

    const restoredDownloads = JSON.parse(text(await call(client, 'browser_downloads', {
      workspaceId: opened.id
    }))) as BrowserDownloadState[]
    expect(restoredDownloads).toEqual([
      expect.objectContaining({
        filename: 'first.txt',
        savePath: `${profileDirectory}/first.txt`,
        state: 'completed'
      })
    ])
    const isolatedAfterRestore = JSON.parse(text(await call(client, 'browser_downloads', {
      workspaceId: secondWorkspaceId
    }))) as BrowserDownloadState[]
    expect(isolatedAfterRestore).toEqual([
      expect.objectContaining({
        filename: 'second.txt',
        savePath: `${profileDirectory}/second.txt`,
        state: 'completed'
      })
    ])

    await call(client, 'browser_downloads', { workspaceId: opened.id, action: 'clear' })
    expect(await appWindow.evaluate('window.hronautDownloads.list()')).toEqual([
      expect.objectContaining({ filename: 'second.txt', state: 'completed' })
    ])

    const rollbackSaved = JSON.parse(text(await call(client, 'browser_saved_workspaces', {
      action: 'save',
      workspaceId: secondWorkspaceId
    }))) as { id: string }
    await electronApp.evaluate(({ BrowserWindow, WebContentsView }) => {
      const mainWindow = BrowserWindow.getAllWindows()[0]
      if (!mainWindow) throw new Error('Main window is unavailable')
      const contentView = mainWindow.contentView as unknown as {
        removeChildView: (view: Electron.WebContentsView) => void
      }
      const viewPrototype = WebContentsView.prototype as unknown as {
        setBounds: (bounds: Electron.Rectangle) => void
      }
      const originalRemoveChildView = contentView.removeChildView
      const originalSetBounds = viewPrototype.setBounds
      const existingViews = new Set(mainWindow.contentView.children)
      let layoutFailed = false
      let restoredView: Electron.WebContentsView | null = null
      contentView.removeChildView = function (view): void {
        if (layoutFailed && view === restoredView) throw new Error('Injected download ownership rollback detach failure')
        return originalRemoveChildView.call(this, view)
      }
      viewPrototype.setBounds = function (this: Electron.WebContentsView, bounds): void {
        if (!layoutFailed && !existingViews.has(this)) {
          restoredView = this
          layoutFailed = true
          throw new Error('Injected download ownership restore layout failure')
        }
        return originalSetBounds.call(this, bounds)
      }
      ;(globalThis as typeof globalThis & {
        __hronautDownloadRestoreFault?: {
          contentView: typeof contentView
          viewPrototype: typeof viewPrototype
          originalRemoveChildView: typeof originalRemoveChildView
          originalSetBounds: typeof originalSetBounds
        }
      }).__hronautDownloadRestoreFault = {
        contentView,
        viewPrototype,
        originalRemoveChildView,
        originalSetBounds
      }
    })
    try {
      const failedOpen = await client.callTool({
        name: 'browser_saved_workspaces',
        arguments: { action: 'open', savedWorkspaceId: rollbackSaved.id }
      }) as CallToolResult
      expect(failedOpen.isError).toBe(true)
      expect(text(failedOpen)).toContain('could not be restored or rolled back')
    } finally {
      await electronApp.evaluate(() => {
        const state = (globalThis as typeof globalThis & {
          __hronautDownloadRestoreFault?: {
            contentView: { removeChildView: (view: Electron.WebContentsView) => void }
            viewPrototype: { setBounds: (bounds: Electron.Rectangle) => void }
            originalRemoveChildView: (view: Electron.WebContentsView) => void
            originalSetBounds: (bounds: Electron.Rectangle) => void
          }
        }).__hronautDownloadRestoreFault
        if (!state) return
        state.contentView.removeChildView = state.originalRemoveChildView
        state.viewPrototype.setBounds = state.originalSetBounds
        delete (globalThis as typeof globalThis & { __hronautDownloadRestoreFault?: unknown }).__hronautDownloadRestoreFault
      })
    }

    const activeWorkspaces = JSON.parse(text(await call(client, 'browser_workspaces', {
      action: 'list'
    }))) as Array<{ id: string; name: string }>
    const recoveredWorkspace = activeWorkspaces.find((workspace) => workspace.name === 'Second download workspace')
    if (!recoveredWorkspace) throw new Error('Recoverable download workspace remained unavailable')
    expect(recoveredWorkspace.id).toBe(secondWorkspaceId)
    const recoveredDownloads = JSON.parse(text(await call(client, 'browser_downloads', {
      workspaceId: recoveredWorkspace.id
    }))) as BrowserDownloadState[]
    expect(recoveredDownloads).toEqual([
      expect.objectContaining({ filename: 'second.txt', state: 'completed' })
    ])

    const unrelatedWorkspaceId = await createWorkspace(client, 'Unrelated download workspace')
    expect(JSON.parse(text(await call(client, 'browser_downloads', {
      workspaceId: unrelatedWorkspaceId
    })))).toEqual([])
  } finally {
    await electronApp.evaluate(() => {
      const state = (globalThis as typeof globalThis & {
        __hronautDownloadRestoreFault?: {
          contentView: { removeChildView: (view: Electron.WebContentsView) => void }
          viewPrototype: { setBounds: (bounds: Electron.Rectangle) => void }
          originalRemoveChildView: (view: Electron.WebContentsView) => void
          originalSetBounds: (bounds: Electron.Rectangle) => void
        }
      }).__hronautDownloadRestoreFault
      if (!state) return
      state.contentView.removeChildView = state.originalRemoveChildView
      state.viewPrototype.setBounds = state.originalSetBounds
      delete (globalThis as typeof globalThis & { __hronautDownloadRestoreFault?: unknown }).__hronautDownloadRestoreFault
    }).catch(() => undefined)
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
