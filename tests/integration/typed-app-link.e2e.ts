import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { answerTrustedDialog, trustedDialog, trustedDialogHeadline } from './trusted-dialog-fixture.js'

// A mailto:, tel: or app link typed in the address bar, or a bookmark of one, showed "Agent workspaces cannot open
// local, privileged, or credential-bearing browser URLs": every website tab is in a workspace, whose tabs load only web
// pages. As in Chrome, Hronaut now asks and hands the link to the app the system uses for it. An agent's stays refused.
test('a link to another app the person types asks, then opens in that app, and the tab keeps its page', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, fixtureOrigin } = capabilities
  const opened = await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: `${fixtureOrigin}/no-js` } }) as CallToolResult
  expect(opened.isError, text(opened)).not.toBe(true)
  await electronApp.evaluate(({ shell }) => {
    const handed: string[] = []
    ;(globalThis as { handedToApps?: string[] }).handedToApps = handed
    shell.openExternal = async (url: string) => { handed.push(url) }
  })
  const handedToApps = () => electronApp.evaluate(() => (globalThis as { handedToApps?: string[] }).handedToApps)
  const personTypes = (url: string) => appWindow.evaluate(`window.hronaut.navigate(${JSON.stringify({ url, tabId })}).then(() => true)`)
  const tabUrl = () => appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)}).url)`)

  // Cancel, which has the keyboard, opens nothing.
  const cancelled = personTypes('mailto:someone@example.test?subject=Hi')
  await expect(trustedDialog(appWindow)).toContainText('Open this link in another app?')
  expect(await trustedDialogHeadline(appWindow)).toBe('This mailto: link opens outside Hronaut.')
  await expect(trustedDialog(appWindow).getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await answerTrustedDialog(appWindow, 'Cancel')
  await expect(cancelled).resolves.toBe(true)
  expect(await handedToApps()).toEqual([])

  const opening = personTypes('zoommtg://zoom.example.test/join?confno=1')
  await answerTrustedDialog(appWindow, 'Open app')
  await expect(opening).resolves.toBe(true)
  expect(await handedToApps()).toEqual(['zoommtg://zoom.example.test/join?confno=1'])
  expect(await tabUrl()).toBe(`${fixtureOrigin}/no-js`)

  // An agent's is still refused, without a question.
  const agent = await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: 'mailto:someone@example.test' } }) as CallToolResult
  expect(agent.isError).toBe(true)
  await expect(trustedDialog(appWindow)).toHaveCount(0)
  expect(await handedToApps()).toHaveLength(1)
})
