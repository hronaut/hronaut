import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const PAGES: Record<string, string> = {
  print: '<title>Print</title><button onclick="window.print(); this.textContent = \'Printed\'">Print</button>',
  plain: '<title>Plain</title><main>Plain page</main>'
}

const text = (result: CallToolResult): string => result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')

async function connect(mcpPort: number, mcpToken: string) {
  const fixture = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end(`<!doctype html>${PAGES[request.url?.slice(1) ?? ''] ?? PAGES.plain}`)
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('The fixture server has no port')
  const authorization = `Bearer ${mcpToken}`
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization } })).ok } catch { return false }
  }).toBe(true)
  const client = new Client({ name: 'print-dialog-guard', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization } } }))
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args }, undefined, { timeout: 20_000 }) as Promise<CallToolResult>
  const workspace = JSON.parse(text(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Print' }))) as { id: string }
  const open = async (page: string) => {
    const opened = await call('browser_new_tab', { workspaceId: workspace.id, url: `http://127.0.0.1:${address.port}/${page}` })
    return { workspaceId: workspace.id, tabId: (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId }
  }
  const close = async (): Promise<void> => {
    await client.close().catch(() => undefined)
    await closeFixtureServer(fixture)
  }
  return { call, open, close }
}

// window.print() holds the page's renderer in the system's print dialog until the person closes it. An agent's click
// on a Print button never returned, and every later call in its workspace answered WORKSPACE_BUSY until then.
test('an agent click that opens the page print dialog settles and leaves the workspace usable', async ({ mcpPort, mcpToken }) => {
  const { call, open, close } = await connect(mcpPort, mcpToken)
  try {
    const printTab = await open('print')
    const plainTab = await open('plain')
    await expect.poll(async () => text(await call('browser_snapshot', printTab))).toContain('button "Print"')

    const startedAt = Date.now()
    const click = await call('browser_click', { ...printTab, selector: 'button' })
    expect(click.isError, text(click)).toBe(true)
    expect(text(click)).toContain('The page opened its print dialog during this action')
    expect(Date.now() - startedAt).toBeLessThan(15_000)

    const held = await call('browser_snapshot', printTab)
    expect(held.isError, text(held)).toBe(true)
    expect(text(held)).toContain('The page is showing its print dialog')

    // An agent's close does not wait for the page, so the tab and its dialog can still go.
    const closing = await call('browser_close_tab', printTab)
    expect(closing.isError, text(closing)).toBeFalsy()
    expect(text(closing)).not.toContain(printTab.tabId)

    const other = await call('browser_snapshot', plainTab)
    expect(other.isError, text(other)).toBeFalsy()
    expect(text(other)).toContain('Plain page')
  } finally {
    await close()
  }
})

test('agent calls on a page the person is printing fail at once instead of waiting for the dialog', async ({ electronApp, mcpPort, mcpToken }) => {
  const { call, open, close } = await connect(mcpPort, mcpToken)
  try {
    const plainTab = await open('plain')
    await expect.poll(async () => text(await call('browser_snapshot', plainTab))).toContain('Plain page')
    // Hronaut's Print opens the same dialog for the person, from the menu or Ctrl/Cmd+P.
    await electronApp.evaluate(({ webContents }) => {
      webContents.getAllWebContents().find(page => page.getURL().endsWith('/plain'))!.print({})
    })

    await expect.poll(async () => text(await call('browser_snapshot', plainTab)), { timeout: 10_000 }).toContain('The page is showing its print dialog')
    const startedAt = Date.now()
    const evaluated = await call('browser_evaluate', { ...plainTab, script: 'document.title' })
    expect(evaluated.isError, text(evaluated)).toBe(true)
    expect(text(evaluated)).toContain('nothing was sent to it')
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  } finally {
    await close()
  }
})
