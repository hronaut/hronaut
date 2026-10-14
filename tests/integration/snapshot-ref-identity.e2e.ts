import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

interface Delta {
  status: string
  changeCounts: { added: number; removed: number; updated: number }
  changes: Array<{ kind: string; key: string; before?: string; after?: string }>
}

test('keeps surviving snapshot refs stable so deltas report only real control changes', async ({ electronApp, mcpPort, mcpToken }) => {
  const html = '<!doctype html><title>Ref identity</title><main>'
    + Array.from({ length: 100 }, (_, index) => `<button type="button">Action ${index}</button>`).join('')
    + '</main>'
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(html)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'snapshot-ref-identity-test', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const parsed = <T>(result: CallToolResult): T => {
    expect(result.isError).not.toBe(true)
    return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as T
  }
  const controlChanges = (delta: Delta) => delta.changes.filter(change => change.key.startsWith('control:'))
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspace = parsed<{ id: string }>(await call('browser_workspaces', { action: 'create', name: 'Ref identity', storage: 'scratch' }))
    const state = parsed<BrowserState>(await call('browser_new_tab', { workspaceId: workspace.id, url }))
    const args = { workspaceId: workspace.id, tabId: state.activeTabId! }
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect(page.getByRole('button', { name: 'Action 99' })).toBeVisible()

    const baseline = await call('browser_snapshot', { ...args, action: 'set-baseline' })
    expect(baseline.isError).not.toBe(true)
    const deltaArgs = { ...args, action: 'delta', baselineId: (baseline.structuredContent as { baselineId: string }).baselineId, maxOutputChars: 50_000 }

    await page.locator('main').evaluate(main => main.prepend(Object.assign(document.createElement('button'), { type: 'button', textContent: 'Help' })))
    const inserted = parsed<Delta>(await call('browser_snapshot', deltaArgs))
    // Positional refs previously reported 100 manufactured control updates.
    expect(inserted.changeCounts.updated).toBe(1) // aggregate TEXT only
    expect(controlChanges(inserted)).toEqual([{ kind: 'added', key: 'control:e101', after: '[e101] button "Help"' }])
    await expect(page.locator('[data-hronaut-ref="e1"]')).toHaveText('Action 0')

    await page.getByRole('button', { name: 'Action 0' }).evaluate(element => element.remove())
    await page.getByRole('button', { name: 'Action 1', exact: true }).evaluate(element => { element.textContent = 'Renamed' })
    expect(controlChanges(parsed<Delta>(await call('browser_snapshot', deltaArgs)))).toEqual([
      { kind: 'updated', key: 'control:e2', before: '[e2] button "Action 1"', after: '[e2] button "Renamed"' },
      { kind: 'removed', key: 'control:e1', before: '[e1] button "Action 0"' }
    ])

    // An identical replacement is a new target, and page JavaScript cannot see
    // or seed the comparison identity.
    await page.getByRole('button', { name: 'Help' }).evaluate(element => element.replaceWith(element.cloneNode(true)))
    expect(await page.evaluate(() => '__hronautSnapshotIdentity' in globalThis)).toBe(false)
    expect(controlChanges(parsed<Delta>(await call('browser_snapshot', deltaArgs)))).toEqual([
      { kind: 'added', key: 'control:e102', after: '[e102] button "Help"' },
      { kind: 'removed', key: 'control:e101', before: '[e101] button "Help"' }
    ])

    await page.goto(`${url}?next=1`)
    expect(parsed(await call('browser_snapshot', deltaArgs))).toMatchObject({ status: 'invalidated', invalidationReason: 'navigation' })
    const fresh = await call('browser_snapshot', { ...args, maxChars: 1_000 })
    expect(fresh.isError).not.toBe(true)
    expect((fresh.structuredContent as { text: string }).text).toContain('[e1] button "Action 0"')
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
