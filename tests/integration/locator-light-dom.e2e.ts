import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('generates usable light-DOM locators instead of ambiguous shadow-piercing matches', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<html><title>Locator scope fixture</title><div id="region">Public region</div><button id="save">Save changes</button><div id="host"></div></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'locator-scope-test', version: '1' })
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    await useMcpWorkspace(client, 'Locator scope', false)
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args }) as CallToolResult
      expect(result.isError).not.toBe(true)
      return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n'))
    }
    const { activeTabId: tabId } = await call('browser_new_tab', { url, active: true })
    await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(tabId), tabId)
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect(page.locator('#save')).toBeVisible()
    expect((await call('browser_generate_locator', { tabId, selector: '#save' })).strategy).toBe('role')
    await page.locator('#host').evaluate(host => {
      host.attachShadow({ mode: 'open' }).innerHTML = '<div id="region">Shadow region</div><button>Save changes</button>'
      document.querySelector('#save')!.addEventListener('click', event => (event.currentTarget as HTMLElement).dataset.clicked = 'true')
    })
    // The previous exported locators cross into the shadow root and are ambiguous.
    await expect(page.locator('#region')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(2)
    for (const selector of ['#region', '#save']) {
      const generated = await call('browser_generate_locator', { tabId, selector })
      expect(generated.strategy).toBe('css')
      expect(generated.locator).toBe(`page.locator(${JSON.stringify(`css:light=${selector}`)})`)
      const engineSelector = JSON.parse(generated.locator.slice('page.locator('.length, -1)) as string
      const locator = page.locator(engineSelector)
      await expect(locator).toHaveCount(1)
      if (selector === '#region') await expect(locator).toHaveText('Public region')
      else {
        await locator.click()
        await expect(locator).toHaveAttribute('data-clicked', 'true')
      }
    }
    await page.locator('#host').evaluate(host => host.remove())
    expect((await call('browser_generate_locator', { tabId, selector: '#save' })).strategy).toBe('role')

    await page.evaluate(() => {
      const branch = '<div>'.repeat(10) + '<button>Repeated deep action</button>' + '</div>'.repeat(10)
      document.body.insertAdjacentHTML('beforeend', `<main><section>${branch}</section><section>${branch}</section></main>`)
      document.querySelectorAll('main button').forEach(button => button.addEventListener('click', () => button.setAttribute('data-clicked', 'true')))
    })
    const requested = 'main > section:nth-of-type(1) button'
    const deep = await call('browser_generate_locator', { tabId, selector: requested })
    expect(deep.strategy).toBe('css')
    expect(deep.locator).toBe(`page.locator(${JSON.stringify(`css:light=${requested}`)})`)
    const deepLocator = page.locator(JSON.parse(deep.locator.slice('page.locator('.length, -1)) as string)
    await expect(deepLocator).toHaveCount(1)
    await deepLocator.click()
    await expect(deepLocator).toHaveAttribute('data-clicked', 'true')
    await expect(page.locator('main > section:nth-of-type(2) button')).not.toHaveAttribute('data-clicked', 'true')
    const ambiguous = await client.callTool({ name: 'browser_generate_locator', arguments: { tabId, selector: 'main button' } }) as CallToolResult
    expect(ambiguous.isError).toBe(true)
    const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult
    expect(snapshot.isError).not.toBe(true)
    const ref = await page.locator(requested).getAttribute('data-hronaut-ref')
    expect(ref).toBeTruthy()
    const fromRef = await call('browser_generate_locator', { tabId, ref })
    expect(fromRef.strategy).toBe('css')
    await expect(page.locator(JSON.parse(fromRef.locator.slice('page.locator('.length, -1)) as string)).toHaveCount(1)
    await expect(page.locator(fromRef.selector)).toHaveAttribute('data-clicked', 'true')
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
