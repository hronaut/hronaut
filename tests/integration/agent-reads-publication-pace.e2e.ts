import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// An agent's browser_navigate reads the browser state for its answer, and that read sent the shell any change still
// waiting for its time. An agent going from page to page sent the shell two states a call, 10 to 20 ms apart: four
// agents sent it about 18 states a second, not the 10 the shell's publications allow.

const STATE_PUBLISH_MS = 100
const NAVIGATIONS = 30

function toolText(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

test('an agent going from page to page leaves the states sent to the shell at their pace', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const server = createServer((request, response) => {
    const page = /^\/page\/(\d+)/.exec(request.url ?? '')?.[1] ?? '0'
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(`<!doctype html><title>Page ${page}</title><h1>Page ${page}</h1>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The site has no port.')
  const base = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'publication-pace-agent', version: '1.0.0' })
  const shellUrl = appWindow.url()
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    await useMcpWorkspace(client, 'Pace agent', false)
    const opened = await client.callTool({ name: 'browser_new_tab', arguments: { url: `${base}/page/0`, active: false } }) as CallToolResult
    expect(opened.isError, toolText(opened)).not.toBe(true)
    // The agent's workspace had no tab, so the one it opened in the background is its only one.
    const [tabId] = (JSON.parse(toolText(opened)) as { tabs: { id: string }[] }).tabs.map((tab) => tab.id)
    // The person does nothing, so every state the shell gets comes from the agent's work.
    await appWindow.waitForTimeout(1_000)

    await electronApp.evaluate(({ webContents }, shellUrl) => {
      const shell = webContents.getAllWebContents().find((candidate) => candidate.getURL() === shellUrl)
      if (!shell) throw new Error('The shell was not found.')
      const send = shell.send
      const sentAt: number[] = []
      shell.send = (channel: string, ...args: unknown[]) => {
        if (channel === 'browser:state-changed') sentAt.push(performance.now())
        send.call(shell, channel, ...args)
      }
      ;(globalThis as Record<string, unknown>).__publicationPace = { sentAt, restore: () => { shell.send = send } }
    }, shellUrl)
    for (let i = 1; i <= NAVIGATIONS; i += 1) {
      const navigated = await client.callTool({ name: 'browser_navigate', arguments: { tabId: tabId!, url: `${base}/page/${i}` } }) as CallToolResult
      expect(navigated.isError, toolText(navigated)).not.toBe(true)
    }
    await appWindow.waitForTimeout(500)
    const sentAt = await electronApp.evaluate(() => {
      const pace = (globalThis as Record<string, unknown>).__publicationPace as { sentAt: number[]; restore: () => void }
      return pace.sentAt
    })
    const gaps = sentAt.slice(1).map((at, index) => Math.round(at - sentAt[index]!))
    // The agent's pages change the state the shell shows, so it still gets them, never sooner than its pace allows.
    expect(sentAt.length, `gaps ${gaps.join(', ')} ms`).toBeGreaterThan(1)
    // A gap is measured from one send to the next, after each read of the state, so it can be a little short of the pace.
    expect(gaps.filter((gap) => gap < STATE_PUBLISH_MS / 2), `gaps ${gaps.join(', ')} ms`).toEqual([])
  } finally {
    await electronApp.evaluate(() => {
      const pace = (globalThis as Record<string, unknown>).__publicationPace as { restore: () => void } | undefined
      delete (globalThis as Record<string, unknown>).__publicationPace
      pace?.restore()
    })
    await client.close()
    await closeFixtureServer(server)
  }
})
