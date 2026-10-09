import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('removes cleared Network rows and details immediately, then displays newly captured requests', async ({ capabilities, appWindow }) => {
  const { client, tabId, openPageTool } = capabilities
  const retained = async () => {
    const result = await client.callTool({ name: 'browser_network', arguments: { tabId } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as Array<{ id: string; url: string; completedAt?: string }>
  }
  const capture = async (suffix: string) => {
    const result = await client.callTool({ name: 'browser_evaluate', arguments: {
      tabId, script: `fetch('/api-details?fixture=network-clear-fixture-${suffix}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'network-clear-fixture' }) }).then(response => response.text()).then(() => true)`
    } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    await expect.poll(async () => (await retained()).some(entry => entry.url.includes(`network-clear-fixture-${suffix}`) && entry.completedAt)).toBe(true)
  }
  await retained()
  await capture('before')
  await openPageTool('Open network monitor')
  const panel = appWindow.getByRole('dialog', { name: 'Network' })
  const search = panel.getByRole('searchbox', { name: 'Filter network requests', exact: true })
  await search.fill('network-clear-fixture')
  const rows = panel.getByRole('listbox', { name: 'Network requests', exact: true }).getByRole('option')
  await expect(rows).toHaveCount(1)
  await rows.click()
  await expect(panel.getByRole('button', { name: 'Copy sanitized cURL', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect.poll(async () => (await retained()).some(entry => entry.url.includes('network-clear-fixture-before'))).toBe(false)
  await expect(rows).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Copy sanitized cURL', exact: true })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Copy sanitized HAR', exact: true })).toBeDisabled()
  await expect(search).toHaveValue('network-clear-fixture')
  await capture('after')
  await panel.getByRole('button', { name: 'Refresh network requests', exact: true }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText('network-clear-fixture-after')
  await expect(panel.getByRole('button', { name: 'Copy sanitized HAR', exact: true })).toBeEnabled()
})
