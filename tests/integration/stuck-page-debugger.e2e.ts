import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// The budget a minute would take is shortened so the stall comes in seconds.
// Set in beforeAll, not at import: tests run as parallel groups, afterAll runs after each group, and a later group
// in the same worker does not import the file again.
test.beforeAll(() => {
  process.env.HRONAUT_INTEGRATION_TEST_HOOKS = '1'
  process.env.HRONAUT_TEST_DEBUGGER_BUDGET_MS = '3000'
})
test.afterAll(() => {
  delete process.env.HRONAUT_INTEGRATION_TEST_HOOKS
  delete process.env.HRONAUT_TEST_DEBUGGER_BUDGET_MS
})

function text(result: CallToolResult): string {
  const content = result.content.find(item => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

// A debugger command a page stuck in a script never answered held the tab's debugger queue: the agent's call never
// returned, and every later debugger action on the tab waited behind it for good.
test('a page stuck in a script fails debugger actions in seconds, shows it is not responding, and a reload replaces it', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  test.setTimeout(120_000)
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Stuck fixture</title><input aria-label="Name">
      <script>window.busy = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} }</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/stuck`
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  const client = new Client({ name: 'Stuck page check', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
  type StateApi = { hronaut: { getState(): Promise<{ tabs: Array<{ id: string; pageProblem?: { kind: string } }> }> } }
  try {
    await connectMcpWorkspace(client, 'Stuck page', false)
    const opened = await client.callTool({ name: 'browser_new_tab', arguments: { url, active: true } }) as CallToolResult
    expect(opened.isError, text(opened)).not.toBe(true)
    const tabId = (JSON.parse(text(opened)).tabs as Array<{ id: string; url: string }>).find(tab => tab.url === url)!.id
    const problem = () => appWindow.evaluate(tabId => (window as unknown as StateApi)
      .hronaut.getState().then(state => state.tabs.find(tab => tab.id === tabId)?.pageProblem?.kind ?? null), tabId)
    const inspect = () => client.callTool({ name: 'browser_computed_accessibility', arguments: { tabId, selector: 'input' } }) as Promise<CallToolResult>
    await expect.poll(async () => (await inspect()).isError ?? false, { timeout: 15_000 }).toBe(false)

    await electronApp.evaluate(({ webContents }, url) => {
      void webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!.executeJavaScript('setTimeout(() => window.busy(90000), 0)')
    }, url)
    await new Promise(resolve => setTimeout(resolve, 500))

    for (const attempt of ['first', 'next']) {
      const startedAt = Date.now()
      const stuck = await inspect()
      const elapsed = Date.now() - startedAt
      expect(stuck.isError, `${attempt}: ${text(stuck)}`).toBe(true)
      expect(stuck.structuredContent, attempt).toMatchObject({ status: 'OUTCOME_UNKNOWN', reason: 'PAGE_NOT_ANSWERING', retrySafe: false })
      // The budget and the reset's grace, not the minute a page usually gets, nor for good.
      expect(elapsed, attempt).toBeLessThan(15_000)
    }

    // The reset asks the page to answer, as a person's input does; a page stuck in a script shows it is not responding.
    await expect.poll(problem, { timeout: 25_000 }).toBe('unresponsive')
    const reloaded = await client.callTool({ name: 'browser_history', arguments: { tabId, action: 'reload', read: 'none' } }) as CallToolResult
    expect(reloaded.isError, text(reloaded)).not.toBe(true)
    expect(await problem()).toBeNull()
    const answered = await inspect()
    expect(answered.isError, text(answered)).not.toBe(true)
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
