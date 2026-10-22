import { createServer, type ServerResponse } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserDownloadState, HronautApi, HronautMcpApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// When you pause and resume agents, a download still running leaves the agent's downloads, and finished ones stay.
// One that finished after that stayed hidden from the agent, and archiving and restoring the workspace handed one
// still running back to the agent's controls.

// Enough of the file for Chromium to start the download, with the rest held back until the test finishes it.
const payload = Buffer.alloc(128 * 1024, 'held download\n')
const sentFirst = 64 * 1024

const text = (result: CallToolResult) => result.content.map((part) => part.type === 'text' ? part.text : '').join('')

test('lists a download once it finishes after you paused and resumed agents, and keeps a running one out after restore', async ({ appWindow, mcpPort, mcpToken }) => {
  const held = new Map<string, ServerResponse>()
  const server = createServer((request, response) => {
    const match = /^\/(\w+)\.bin$/.exec(request.url ?? '')
    if (match) {
      response.writeHead(200, { 'content-disposition': `attachment; filename="${match[1]}.bin"`, 'content-type': 'application/octet-stream', 'content-length': payload.length })
      response.write(payload.subarray(0, sentFirst))
      held.set(match[1]!, response)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Files</title><a id="first" href="/first.bin" download>First</a><a id="second" href="/second.bin" download>Second</a>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Download fixture did not expose a port')
  const finish = (name: string) => held.get(name)!.end(payload.subarray(sentFirst))

  const client = new Client({ name: 'download-after-control-change', version: '1.0.0' })
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return text(result)
  }
  try {
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok
      } catch {
        return false
      }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const { id: workspaceId } = JSON.parse(await call('browser_workspaces', { action: 'create', name: 'Files' })) as { id: string }
    const { activeTabId: tabId } = JSON.parse(await call('browser_new_tab', { workspaceId, url: `http://127.0.0.1:${address.port}/` })) as { activeTabId: string }
    await call('browser_wait', { workspaceId, tabId, selector: '#second' })
    await call('browser_click', { workspaceId, tabId, selector: '#first' })
    await call('browser_click', { workspaceId, tabId, selector: '#second' })
    const agentSees = async () => (JSON.parse(await call('browser_downloads', { workspaceId })) as BrowserDownloadState[])
      .map((download) => `${download.filename} ${download.state}`).sort()
    await expect.poll(agentSees).toEqual(['first.bin progressing', 'second.bin progressing'])

    await appWindow.evaluate(() => (window as unknown as { hronautMcp: HronautMcpApi }).hronautMcp.setPaused(true))
    await expect(appWindow.getByRole('button', { name: /^Agents paused/ })).toBeVisible()
    await appWindow.evaluate(() => (window as unknown as { hronautMcp: HronautMcpApi }).hronautMcp.setPaused(false))
    await call('browser_workspaces', { action: 'claim-ownership', workspaceId })
    expect(await agentSees()).toEqual([])

    finish('second')
    await expect.poll(() => appWindow.evaluate(async () => (
      (await (window as unknown as { hronautDownloads: { list(): Promise<BrowserDownloadState[]> } }).hronautDownloads.list())
        .find((download) => download.filename === 'second.bin')?.state
    ))).toBe('completed')
    expect(await agentSees()).toEqual(['second.bin completed'])

    // You archive the workspace and restore it from the archive.
    await appWindow.evaluate(async (id) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      await api.saveAndCloseTabGroup(id)
      await api.restoreSavedTabGroup(id)
    }, workspaceId)
    expect(await agentSees()).toEqual(['second.bin completed'])

    finish('first')
    await expect.poll(agentSees).toEqual(['first.bin completed', 'second.bin completed'])
  } finally {
    for (const response of held.values()) response.destroy()
    await client.close()
    await closeFixtureServer(server)
  }
})
