import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('pauses displayed Console updates while capture continues, with explicit refresh and resume', async ({ capabilities, appWindow, electronApp }, testInfo) => {
  const { client, tabId, openPageTool } = capabilities
  const log = async (message: string) => {
    const result = await client.callTool({ name: 'browser_evaluate', arguments: {
      tabId, script: `console.warn(${JSON.stringify(message)})`
    } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
  }
  await log('pause-fixture before')
  await openPageTool('Open Console')
  const panel = appWindow.getByRole('dialog', { name: 'Console' })
  const search = panel.getByRole('searchbox', { name: 'Filter Console messages', exact: true })
  await search.fill('pause-fixture')
  const rows = panel.locator('.console-message')
  await expect(rows).toHaveCount(1)
  await panel.getByRole('button', { name: 'Pause displayed updates', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('Log collection continues')
  await testInfo.attach('paused-console', { body: await panel.screenshot(), contentType: 'image/png' })
  await log('pause-fixture during')
  await expect.poll(async () => {
    const result = await client.callTool({ name: 'browser_console', arguments: { tabId } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)).some((entry: { message: string }) => entry.message === 'pause-fixture during')
  }).toBe(true)
  await expect(rows).toHaveCount(1)
  await panel.getByRole('button', { name: 'Copy filtered', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Copied filtered', exact: true })).toBeVisible()
  const copied = JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText()))
  expect(copied).toMatchObject({ displayUpdatesPaused: true, pendingMessages: 'unknown', missedMessages: 'unknown' })
  expect(copied.messages.map((entry: { message: string }) => entry.message)).toEqual(['pause-fixture before'])
  await panel.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(rows).toHaveCount(2)
  await expect(panel.getByRole('button', { name: 'Resume displayed updates', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await log('pause-fixture resume')
  await panel.getByRole('button', { name: 'Resume displayed updates', exact: true }).click()
  await expect(rows).toHaveCount(3)
  await expect(search).toHaveValue('pause-fixture')
  await panel.getByRole('button', { name: 'Pause displayed updates', exact: true }).click()
  await panel.getByRole('button', { name: 'Close Console', exact: true }).click()
  await openPageTool('Open Console')
  await expect(panel.getByRole('button', { name: 'Pause displayed updates', exact: true })).toHaveAttribute('aria-pressed', 'false')
})
