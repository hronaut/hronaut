import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { answerTrustedDialog, trustedDialog, trustedDialogHeadline } from './trusted-dialog-fixture.js'

// A page that asks before it is left, as an editor with unsaved changes does, kept itself open when an agent or a
// person loaded another address, and nothing said so: browser_navigate reported success and the address bar did
// nothing. Chrome asks "Leave site?".

test('a page that asks before it is left stops browser_navigate with an error and asks a person', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, fixtureOrigin } = capabilities
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
    await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
  // As JSON, since browser_evaluate gives a string result as it is.
  const evaluate = async (script: string): Promise<unknown> => {
    const result = await call('browser_evaluate', { script: `JSON.stringify(${script})` })
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  const start = `${fixtureOrigin}/?leave=draft`
  const destination = `${fixtureOrigin}/no-js`
  const opened = await call('browser_navigate', { url: start })
  expect(opened.isError, text(opened)).not.toBe(true)
  await evaluate(`(() => {
    document.body.innerHTML = '<input id="draft">'
    addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = '' })
    return true
  })()`)
  // A page may ask only once it was used, as by a click.
  const clicked = await call('browser_click', { selector: '#draft' })
  expect(clicked.isError, text(clicked)).not.toBe(true)
  // Keep Playwright from also dismissing the page's question, which would race Electron's own handling.
  for (const page of electronApp.context().pages()) page.on('dialog', () => undefined)

  const navigated = await call('browser_navigate', { url: destination })
  expect(navigated.isError).toBe(true)
  expect(text(navigated)).toContain('The page asked to confirm before it is left')
  expect(text(navigated)).toContain('so it stayed open and nothing was loaded')
  expect(await evaluate('location.href')).toBe(start)

  const personNavigates = () => appWindow.evaluate(`window.hronaut.navigate(${JSON.stringify({ url: destination, tabId })}).then(() => true)`)
  // A person is asked in Hronaut's own dialog over the page, with Keep editing focused; keeping the page leaves it as it was.
  const kept = personNavigates()
  await expect(trustedDialog(appWindow)).toHaveAttribute('data-topic', 'unsaved-changes')
  expect(await trustedDialogHeadline(appWindow)).toBe('This page asked Hronaut to confirm before leaving it.')
  await expect(trustedDialog(appWindow)).toContainText('Leave this page?')
  await expect(trustedDialog(appWindow).getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused()
  await answerTrustedDialog(appWindow, 'Keep editing')
  await kept
  expect(await evaluate('location.href')).toBe(start)

  // Leaving loads the address, even after the page changed its address within itself while the question was open, as an
  // editor's autosave does.
  const left = personNavigates()
  await expect(trustedDialog(appWindow)).toBeVisible()
  await electronApp.evaluate(async ({ webContents }, start) => {
    const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === start)
    await page?.executeJavaScript(`history.replaceState(null, '', location.href + '&saved=1')`, false)
  }, start)
  await answerTrustedDialog(appWindow, 'Leave page')
  await left
  await expect.poll(() => evaluate('location.href')).toBe(destination)
})
