import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('copies the displayed sanitized response body without copying request metadata or replaying it', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, openPageTool } = capabilities
  const retained = async () => {
    const result = await client.callTool({ name: 'browser_network', arguments: { tabId } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as Array<{ id: string; url: string; completedAt?: string }>
  }
  await retained()
  const fetched = await client.callTool({ name: 'browser_evaluate', arguments: {
    tabId, script: "fetch('/api-details?fixture=response-copy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'response-copy-fixture' }) }).then(response => response.text()).then(() => true)"
  } }) as CallToolResult
  expect(fetched.isError, text(fetched)).not.toBe(true)
  await expect.poll(async () => (await retained()).some(entry => entry.url.includes('fixture=response-copy') && entry.completedAt)).toBe(true)
  await openPageTool('Open network monitor')
  const panel = appWindow.getByRole('dialog', { name: 'Network' })
  await panel.getByRole('searchbox', { name: 'Filter network requests', exact: true }).fill('fixture=response-copy')
  const row = panel.getByRole('listbox', { name: 'Network requests', exact: true }).getByRole('option')
  await expect(row).toHaveCount(1)
  await row.click()
  const responseSection = panel.locator('summary').filter({ hasText: /^Response body/ }).locator('..')
  await responseSection.locator('summary').click()
  const displayed = await responseSection.locator('pre').innerText()
  expect(JSON.parse(displayed)).toEqual({ ok: true, receivedQuery: 'response-copy-fixture', accessToken: '[REDACTED]', visible: 'response-kept' })
  await responseSection.getByRole('button', { name: 'Copy sanitized response body', exact: true }).click()
  await expect(responseSection.getByRole('button', { name: 'Copied response body', exact: true })).toBeVisible()
  expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(displayed)
  expect((await retained()).filter(entry => entry.url.includes('fixture=response-copy'))).toHaveLength(1)
  await panel.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(panel.getByRole('button', { name: /Copy sanitized response body|Copied response body/ })).toHaveCount(0)
})
