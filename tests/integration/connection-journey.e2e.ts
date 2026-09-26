import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('separates listener, connected client, and first page probe and preserves keyboard control', async ({ electronApp, appWindow, mcpPort, mcpToken }, testInfo) => {
  const started = Date.now()
  const home = (script: string) => electronApp.evaluate(async ({ webContents }, source) => {
    const contents = webContents.getAllWebContents().find(item => item.getURL().startsWith('hronaut://home'))
    return contents?.executeJavaScript(source)
  }, script)
  await expect.poll(() => home('Boolean(document.querySelector("#server-state .dot.ready"))')).toBe(true)
  expect(await home('document.getElementById("home-onboarding").hidden')).toBe(false)
  await home(`document.querySelector('#home-onboarding [data-open-view]').click(); document.querySelector('[data-guide="codex"]').click(); document.querySelector('[data-copy-target="guide-code"]').click()`)
  await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain(`http://127.0.0.1:${mcpPort}/mcp`)

  const trigger = appWindow.getByRole('button', { name: 'MCP ready', exact: true })
  await trigger.click()
  const summary = appWindow.locator('.mcp-readiness-summary')
    await expect(summary).toBeVisible()
    expect(await summary.getByRole('button', { name: 'Copy URL' }).evaluate(button => parseFloat(getComputedStyle(button).borderRadius))).toBeGreaterThanOrEqual(4)
  await expect(summary.locator('dd').nth(1)).toHaveText('0')
  await expect(summary.locator('dd').nth(2)).not.toHaveText('Done')
  await appWindow.keyboard.press('Escape')
  await expect(trigger).toBeFocused()

  const server = createServer((_request, response) => response.end('<!doctype html><title>First page check</title><h1>First page check</h1>'))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const client = new Client({ name: 'connection-journey', version: '1.0.0' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } } }))
    await trigger.click()
    await expect(summary.locator('dd').nth(1)).toHaveText('1')
    await expect(summary.locator('dd').nth(2)).not.toHaveText('Done')
    await appWindow.keyboard.press('Escape')
    await useMcpWorkspace(client, 'First page check')
    const navigation = await client.callTool({ name: 'browser_navigate', arguments: { url: `http://127.0.0.1:${address.port}` } })
    expect(navigation.isError).not.toBe(true)
    const probe = await client.callTool({ name: 'browser_snapshot', arguments: {} })
    expect(probe.isError).not.toBe(true)
    await expect.poll(() => home(`import(document.querySelector('script[type="module"]').src).then(module => module.homeController.refresh()).then(() => localStorage.getItem('hronaut.home.onboarded'))`)).toBe('true')
    await trigger.click()
    await expect(summary.locator('dd').nth(2)).toHaveText('Done')
    expect(await summary.locator('strong').evaluate(heading => {
      const bounds = heading.getBoundingClientRect()
      return heading.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
    })).toBe(true)
    const bounds = await summary.boundingBox()
    const viewport = appWindow.viewportSize()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    if (viewport) expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
    await appWindow.screenshot({ path: testInfo.outputPath('connection-summary.png') })
    await appWindow.keyboard.press('Escape')
    await appWindow.getByRole('button', { name: 'Pause agents', exact: true }).click()
    await expect(appWindow.getByRole('button', { name: 'Resume agents', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await appWindow.getByRole('button', { name: 'Resume agents', exact: true }).click()
    await expect(trigger).toBeVisible()
    await testInfo.attach('automated-journey-time', { body: JSON.stringify({ milliseconds: Date.now() - started, humanUsabilityMeasurement: false }), contentType: 'application/json' })
  } finally { await client.close(); await closeFixtureServer(server) }
})
