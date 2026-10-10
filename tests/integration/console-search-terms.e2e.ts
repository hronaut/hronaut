import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('searches words across retained Console messages and stacks while preserving copy and paused scope', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, openPageTool } = capabilities
  const emit = async (later = false) => {
    const result = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: `(() => {
      function consoleSearchWorker() {
        ${later ? "console.error('console-terms-fixture later request failed');" : `
          console.warn('console-terms-fixture request pending');
          console.error('console-terms-fixture request failed');
        `}
      }
      consoleSearchWorker();
      ${later ? '' : "console.info('console-terms-fixture unrelated');"}
      return true;
    })()` } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
  }
  await emit()
  await openPageTool('Open Console')
  const panel = appWindow.getByRole('dialog', { name: 'Console', exact: true })
  const search = panel.getByRole('searchbox', { name: 'Filter Console messages', exact: true })
  const rows = panel.locator('.console-message')
  await search.fill('console-terms-fixture')
  await expect(rows).toHaveCount(3)
  await search.fill('  CONSOLESEARCHWORKER   request  ')
  await expect(rows).toHaveCount(2)
  await panel.getByRole('button', { name: 'Copy filtered', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Copied filtered', exact: true })).toBeVisible()
  const copied = JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText()))
  expect(copied.filter).toEqual({ query: 'CONSOLESEARCHWORKER   request', level: 'all' })
  expect(copied.messages.map((entry: { message: string }) => entry.message)).toEqual([
    'console-terms-fixture request failed', 'console-terms-fixture request pending'
  ])
  const exclusion = panel.getByRole('searchbox', { name: 'Exclude text', exact: true })
  await exclusion.fill('request consoleSearchWorker')
  await expect(rows).toHaveCount(2)
  await exclusion.fill('request failed')
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText('request pending')
  await exclusion.fill('')
  const level = panel.getByRole('combobox', { name: 'Filter Console by level' })
  await level.selectOption('error')
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText('request failed')
  await panel.getByRole('button', { name: 'Pause displayed updates', exact: true }).click()
  await emit(true)
  await expect.poll(async () => {
    const result = await client.callTool({ name: 'browser_console', arguments: { tabId } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)).some((entry: { message: string }) => entry.message === 'console-terms-fixture later request failed')
  }).toBe(true)
  await search.fill('failed consoleSearchWorker')
  await expect(rows).toHaveCount(1)
  await panel.getByRole('button', { name: 'Copy filtered', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Copied filtered', exact: true })).toBeVisible()
  const paused = JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText()))
  expect(paused.displayUpdatesPaused).toBe(true)
  expect(paused.messages.map((entry: { message: string }) => entry.message)).toEqual(['console-terms-fixture request failed'])
  await panel.getByRole('button', { name: 'Copy all', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Copied all', exact: true })).toBeVisible()
  const all = JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText()))
  expect(all.messages.some((entry: { message: string }) => entry.message === 'console-terms-fixture unrelated')).toBe(true)
  expect(all.messages.some((entry: { message: string }) => entry.message === 'console-terms-fixture later request failed')).toBe(false)
  await panel.getByRole('button', { name: 'Resume displayed updates', exact: true }).click()
  await expect(rows).toHaveCount(2)
  await search.fill('unrelated failed')
  await expect(rows).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Copy filtered', exact: true })).toBeDisabled()
  await search.fill('console-terms-fixture')
  await level.selectOption('all')
  await expect(rows).toHaveCount(4)
})
