import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

// An agent's browser_snapshot on a tab showing a page's source (view-source:) never answered.

test('an agent\'s page tools answer at once on a page\'s source, and work again on the page itself', async ({ capabilities }) => {
  const { client, tabId } = capabilities
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Source fixture</title><h1>hronaut-source-marker</h1>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const page = `http://127.0.0.1:${address.port}/page`
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const started = Date.now()
    const result = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
    return { result, elapsed: Date.now() - started }
  }
  try {
    const opened = await call('browser_navigate', { url: `view-source:${page}` })
    expect(opened.result.isError, text(opened.result)).not.toBe(true)

    const snapshot = await call('browser_snapshot')
    expect(snapshot.result.isError).toBe(true)
    expect(text(snapshot.result)).toContain('This tab shows a page\'s source (a view-source: address), where page scripts never finish; nothing was sent to it.')
    expect(snapshot.elapsed).toBeLessThan(5_000)
    // A screenshot still shows the source.
    const screenshot = await call('browser_screenshot')
    expect(screenshot.result.isError, text(screenshot.result)).not.toBe(true)

    const back = await call('browser_navigate', { url: page })
    expect(back.result.isError, text(back.result)).not.toBe(true)
    const again = await call('browser_snapshot')
    expect(again.result.isError, text(again.result)).not.toBe(true)
    expect(text(again.result)).toContain('hronaut-source-marker')
  } finally {
    await closeFixtureServer(server)
  }
})
