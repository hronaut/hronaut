import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

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

test('answers the agent\'s answer to an alert a new page shows as it loads', async ({ capabilities, electronApp, appWindow }) => {
  const { client, workspace } = capabilities
  leaveDialogsToAgent(electronApp)
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Welcome page</title><script>alert("Welcome"); document.title = "Answered"</script>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  try {
    const call = (name: string, args: Record<string, unknown>) => Promise.race([
      client.callTool({ name, arguments: args }) as Promise<CallToolResult>,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`${name} did not answer`)), 10_000))
    ])
    const opened = call('browser_new_tab', { workspaceId: workspace.workspaceId, url, active: true }).catch((error: Error) => error)
    let tabId: string | undefined
    await expect.poll(async () => {
      const state = await appWindow.evaluate('window.hronaut.getState()') as { tabs: Array<{ id: string, url: string, dialog?: { message: string } }> }
      const tab = state.tabs.find((candidate) => candidate.url === url)
      tabId = tab?.id
      return tab?.dialog?.message
    }).toBe('Welcome')
    const answered = await call('browser_dialog', { workspaceId: workspace.workspaceId, tabId, action: 'accept' })
    expect(answered.isError, text(answered)).not.toBe(true)
    await expect.poll(async () => (await tabState(appWindow, tabId!))?.title).toBe('Answered')
    const openedResult = await opened
    expect(openedResult instanceof Error ? openedResult.message : text(openedResult)).not.toContain('did not answer')
  } finally {
    await closeFixtureServer(server)
  }
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
