import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test, text } from './capability-fixtures.js'

// An agent answers a website dialog through the page's debugger, which closed the dialog but left Electron's box for it
// on screen, keeping Hronaut's window disabled until the person clicked it. Waiting for that box before answering must
// not let Electron answer first the dialogs it answers itself, such as a page asking before it unloads. While a dialog
// waited, an agent's network or issues tool set up the page's monitoring again, which waits for the page the dialog
// holds: the tool never answered, and neither did the agent's browser_dialog, so only the person could free the page.

/** Playwright would answer the page's dialogs itself; the agent answers them here. */
function leaveDialogsToAgent(electronApp: ElectronApplication): void {
  const leaveDialogs = (page: Page) => page.on('dialog', () => undefined)
  for (const page of electronApp.context().pages()) leaveDialogs(page)
  electronApp.context().on('page', leaveDialogs)
}

const windowEnabled = (electronApp: ElectronApplication) => electronApp.evaluate(({ BrowserWindow }) => (
  BrowserWindow.getAllWindows().find((window) => window.isVisible())!.isEnabled()
))

function runInPage(electronApp: ElectronApplication, url: string, script: string): Promise<unknown> {
  return electronApp.evaluate(({ webContents }, { url, script }) => webContents.getAllWebContents()
    .find((contents) => contents.getURL() === url)!.executeJavaScript(script), { url, script })
}

async function tabState(appWindow: Page, tabId: string) {
  const state = await appWindow.evaluate('window.hronaut.getState()') as {
    tabs: Array<{ id: string, url: string, title: string, dialog?: { message: string } }>
  }
  return state.tabs.find((tab) => tab.id === tabId)
}

test('closes the box of a page alert the agent answers', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  leaveDialogsToAgent(electronApp)
  await runInPage(electronApp, fixtureUrl, 'setTimeout(() => { alert("Unsaved draft"); document.title = "Answered" }, 0); true')
  await expect.poll(async () => (await tabState(appWindow, tabId))?.dialog?.message).toBe('Unsaved draft')
  await expect.poll(() => windowEnabled(electronApp)).toBe(false)

  const answered = await client.callTool({ name: 'browser_dialog', arguments: { tabId, action: 'accept' } }) as CallToolResult
  expect(answered.isError, text(answered)).not.toBe(true)
  await expect.poll(async () => (await tabState(appWindow, tabId))?.title).toBe('Answered')
  await expect.poll(() => windowEnabled(electronApp)).toBe(true)
})

test('answers the agent\'s page tools while a page alert waits, and then its answer to the alert', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  leaveDialogsToAgent(electronApp)
  await runInPage(electronApp, fixtureUrl, 'setTimeout(() => { alert("Unsaved draft"); document.title = "Answered" }, 0); true')
  await expect.poll(async () => (await tabState(appWindow, tabId))?.dialog?.message).toBe('Unsaved draft')

  const call = (name: string, args: Record<string, unknown>) => Promise.race([
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`${name} did not answer`)), 10_000))
  ])
  for (const name of ['browser_network', 'browser_issues']) {
    const result = await call(name, { tabId })
    expect(result.isError, text(result)).not.toBe(true)
  }
  const answered = await call('browser_dialog', { tabId, action: 'accept' })
  expect(answered.isError, text(answered)).not.toBe(true)
  await expect.poll(async () => (await tabState(appWindow, tabId))?.title).toBe('Answered')
})

test('leaves a page that asks before it unloads when the agent clicks away and accepts', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  leaveDialogsToAgent(electronApp)
  await runInPage(electronApp, fixtureUrl, `
    addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = '' })
    document.body.insertAdjacentHTML('beforeend', '<a id="leave" href="/?view=left">Leave</a>')
    true`)

  const clicked = await client.callTool({
    name: 'browser_click',
    arguments: { tabId, selector: '#leave', dialogAction: 'accept' }
  }) as CallToolResult
  expect(clicked.isError, text(clicked)).not.toBe(true)
  await expect.poll(async () => (await tabState(appWindow, tabId))?.url).toContain('view=left')
  expect(await windowEnabled(electronApp)).toBe(true)
})
