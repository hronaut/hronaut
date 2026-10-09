import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('copies the displayed sanitized request URL without replaying traffic', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, openPageTool } = capabilities
  const retained = async () => {
    const result = await client.callTool({ name: 'browser_network', arguments: { tabId } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as Array<{ id: string; url: string; completedAt?: string }>
  }
  await retained()
  const fetched = await client.callTool({ name: 'browser_evaluate', arguments: {
    tabId, script: "fetch('/api-details?fixture=url-copy&token=url-copy-private-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'url-copy-fixture' }) }).then(response => response.text()).then(() => true)"
  } }) as CallToolResult
  expect(fetched.isError, text(fetched)).not.toBe(true)
  await expect.poll(async () => (await retained()).some(entry => entry.url.includes('fixture=url-copy') && entry.completedAt)).toBe(true)
  await openPageTool('Open network monitor')
  const panel = appWindow.getByRole('dialog', { name: 'Network' })
  await panel.getByRole('searchbox', { name: 'Filter network requests', exact: true }).fill('fixture=url-copy')
  const row = panel.getByRole('listbox', { name: 'Network requests', exact: true }).getByRole('option')
  await expect(row).toHaveCount(1)
  await row.click()
  const displayed = await panel.locator('.network-detail-url').innerText()
  expect(new URL(displayed).searchParams.get('token')).toBe('[REDACTED]')
  expect(displayed).not.toContain('url-copy-private-token')
  const matching = (await retained()).filter(entry => entry.url.includes('fixture=url-copy'))
  expect(matching).toHaveLength(1)
  expect(displayed).toBe(matching[0]!.url)
  await panel.getByRole('button', { name: 'Copy sanitized URL', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Copied URL', exact: true })).toBeVisible()
  expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(displayed)
  expect((await retained()).filter(entry => entry.url.includes('fixture=url-copy'))).toHaveLength(1)
  await panel.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(panel.getByRole('button', { name: /Copy sanitized URL|Copied URL/ })).toHaveCount(0)
})
