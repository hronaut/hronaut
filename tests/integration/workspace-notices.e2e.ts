import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test, text } from './capability-fixtures.js'

// An agent working in one tab did not hear that another tab of its workspace showed a dialog or crashed: it found out
// only when a later call there failed or hung. Its next result in the workspace now says so, once for each event.

function leaveDialogsToAgent(electronApp: ElectronApplication): void {
  const leaveDialogs = (page: Page) => page.on('dialog', () => undefined)
  for (const page of electronApp.context().pages()) leaveDialogs(page)
  electronApp.context().on('page', leaveDialogs)
}

const notices = (result: CallToolResult) => result.content
  .map(item => item.type === 'text' ? item.text : '')
  .filter(item => item.startsWith('Meanwhile in this workspace:'))

test('tells the agent about a dialog and a crash in another tab of its workspace, once each', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureOrigin } = capabilities
  leaveDialogsToAgent(electronApp)
  const otherUrl = `${fixtureOrigin}/?other-tab`
  const opened = await client.callTool({ name: 'browser_new_tab', arguments: { url: otherUrl, active: false } }) as CallToolResult
  expect(opened.isError, text(opened)).not.toBe(true)
  const otherId = (JSON.parse(text(opened)) as { tabs: Array<{ id: string; url: string }> }).tabs.find(tab => tab.url === otherUrl)!.id
  const otherTab = async () => (await appWindow.evaluate('window.hronaut.getState()') as {
    tabs: Array<{ id: string; dialog?: { id: string; message: string }; pageProblem?: { kind: string } }>
  }).tabs.find(tab => tab.id === otherId)

  const inOtherPage = (script: string) => electronApp.evaluate(({ webContents }, { url, script }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    return page ? page.executeJavaScript(script) : false
  }, { url: otherUrl, script })
  await expect.poll(() => inOtherPage('document.readyState === "complete"')).toBe(true)
  await inOtherPage('setTimeout(() => alert("Draft saved"), 0); true')
  await expect.poll(async () => (await otherTab())?.dialog?.message).toBe('Draft saved')
  const dialogId = (await otherTab())!.dialog!.id

  const read = () => client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as Promise<CallToolResult>
  const first = await read()
  expect(first.isError, text(first)).not.toBe(true)
  expect(notices(first)).toHaveLength(1)
  expect(notices(first)[0]).toContain(`Tab ${otherId} `)
  expect(notices(first)[0]).toContain('shows a website alert: "Draft saved"')
  expect(notices(first)[0]).toContain(`dialogId "${dialogId}"`)
  expect(notices(await read())).toEqual([])

  const answered = await client.callTool({ name: 'browser_dialog', arguments: { tabId: otherId, action: 'accept' } }) as CallToolResult
  expect(answered.isError, text(answered)).not.toBe(true)
  await electronApp.evaluate(({ webContents }, url) => {
    webContents.getAllWebContents().find(contents => contents.getURL() === url)?.forcefullyCrashRenderer()
  }, otherUrl)
  await expect.poll(async () => (await otherTab())?.pageProblem?.kind).toBe('renderer-gone')
  const afterCrash = await read()
  expect(afterCrash.isError, text(afterCrash)).not.toBe(true)
  expect(notices(afterCrash)).toHaveLength(1)
  expect(notices(afterCrash)[0]).toContain(`Tab ${otherId} `)
  expect(notices(afterCrash)[0]).toContain('its page stopped working')
  expect(notices(await read())).toEqual([])
})
