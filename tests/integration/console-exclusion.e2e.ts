import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('excludes Console noise without deleting retained messages or changing Copy all', async ({ capabilities, appWindow, electronApp }, testInfo) => {
  const { client, tabId, openPageTool } = capabilities
  const result = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: `(() => {
    console.warn('exclude-fixture heartbeat');
    console.warn('exclude-fixture needs attention');
    console.error('exclude-fixture request failed');
    return true;
  })()` } }) as CallToolResult
  expect(result.isError, text(result)).not.toBe(true)
  await openPageTool('Open Console')
  const panel = appWindow.getByRole('dialog', { name: 'Console' })
  await panel.getByRole('searchbox', { name: 'Filter Console messages', exact: true }).fill('exclude-fixture')
  const rows = panel.locator('.console-message')
  await expect(rows).toHaveCount(3)
  const exclusion = panel.getByRole('searchbox', { name: 'Exclude text', exact: true })
  await exclusion.fill(' HEARTBEAT ')
  await expect(rows).toHaveCount(2)
  await expect(panel).not.toContainText('exclude-fixture heartbeat')
  await expect(panel).toContainText('exclude-fixture request failed')
  await expect(exclusion).toBeFocused()
  await panel.getByRole('button', { name: 'Copy filtered', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Copied filtered', exact: true })).toBeVisible()
  const filtered = JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText()))
  expect(filtered.filter).toEqual({ query: 'exclude-fixture', level: 'all', excludeText: 'HEARTBEAT' })
  expect(filtered.messages.map((entry: { message: string }) => entry.message)).toEqual([
    'exclude-fixture request failed', 'exclude-fixture needs attention'
  ])
  await panel.getByRole('button', { name: 'Copy all', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Copied all', exact: true })).toBeVisible()
  const all = JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText()))
  expect(all.messages.some((entry: { message: string }) => entry.message === 'exclude-fixture heartbeat')).toBe(true)
  await panel.getByRole('combobox', { name: 'Filter Console by level' }).selectOption('warning')
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText('exclude-fixture needs attention')
  await testInfo.attach('console-exclusion', { body: await panel.screenshot(), contentType: 'image/png' })
  await exclusion.fill('exclude-fixture')
  await expect(rows).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Copy filtered', exact: true })).toBeDisabled()
  await exclusion.fill('')
  await expect(rows).toHaveCount(2)
  await panel.getByRole('combobox', { name: 'Filter Console by level' }).selectOption('all')
  await expect(rows).toHaveCount(3)
})
