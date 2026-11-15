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

// Reload, Back and Forward did nothing at all on such a page, and browser_history reported success. Chrome asks
// "Reload site?" or "Leave site?".
test('a page that asks before it is left stops browser_history with an error and asks a person about Reload and Back', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, fixtureOrigin } = capabilities
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
    await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
  const evaluate = async (script: string): Promise<unknown> => {
    const result = await call('browser_evaluate', { script: `JSON.stringify(${script})` })
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  const previous = `${fixtureOrigin}/no-js`
  const start = `${fixtureOrigin}/?leave=draft`
  for (const url of [previous, start]) {
    const opened = await call('browser_navigate', { url })
    expect(opened.isError, text(opened)).not.toBe(true)
  }
  await evaluate(`(() => {
    document.body.innerHTML = '<input id="draft">'
    window.draftKept = true
    addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = '' })
    return true
  })()`)
  const clicked = await call('browser_click', { selector: '#draft' })
  expect(clicked.isError, text(clicked)).not.toBe(true)
  for (const page of electronApp.context().pages()) page.on('dialog', () => undefined)
  // The same page, not a reloaded one, is still open.
  const pageKept = async (): Promise<void> => {
    expect(await evaluate('location.href')).toBe(start)
    expect(await evaluate('window.draftKept === true')).toBe(true)
  }

  for (const action of ['reload', 'back']) {
    const result = await call('browser_history', { action })
    expect(result.isError, action).toBe(true)
    expect(text(result)).toContain('so it stayed open and nothing was loaded')
    await pageKept()
  }

  // A person's Reload asks in Hronaut's own dialog; keeping the page leaves it as it was.
  const reloaded = appWindow.evaluate(`window.hronaut.reload(${JSON.stringify(tabId)}).then(() => true)`)
  await expect(trustedDialog(appWindow)).toHaveAttribute('data-topic', 'unsaved-changes')
  expect(await trustedDialogHeadline(appWindow)).toBe('This page asked Hronaut to confirm before reloading it.')
  await expect(trustedDialog(appWindow)).toContainText('Reload this page?')
  await answerTrustedDialog(appWindow, 'Keep editing')
  await reloaded
  await pageKept()

  // Back to an entry the page added within itself, as a web app's own pages, leaves no page, so it asks nothing and
  // goes at once.
  await evaluate(`(history.pushState(null, '', location.href + '#saved'), true)`)
  const sameDocumentBack = Date.now()
  await appWindow.evaluate(`window.hronaut.back(${JSON.stringify(tabId)}).then(() => true)`)
  expect(Date.now() - sameDocumentBack).toBeLessThan(10_000)
  await expect(trustedDialog(appWindow)).toHaveCount(0)
  await pageKept()

  // A person's Back asks whether to leave, and leaving goes back.
  const wentBack = appWindow.evaluate(`window.hronaut.back(${JSON.stringify(tabId)}).then(() => true)`)
  await expect(trustedDialog(appWindow)).toContainText('Leave this page?')
  await answerTrustedDialog(appWindow, 'Leave page')
  await wentBack
  await expect.poll(() => evaluate('location.href')).toBe(previous)
})
