import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

// A link click, form submission or script navigation on a page that asks before it is left, as an editor with
// unsaved changes does, did nothing at all: Electron kept the page and cancelled the navigation without a word.
// Chrome asks "Leave site?". The question is the system's own message box, which is stubbed here.

test('a person leaving a page that asks before it is left by a link is asked, and an agent is not', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureOrigin } = capabilities
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
    await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
  const start = `${fixtureOrigin}/?leave=link`
  const destination = `${fixtureOrigin}/no-js`
  const opened = await call('browser_navigate', { url: start })
  expect(opened.isError, text(opened)).not.toBe(true)
  const prepared = await call('browser_evaluate', { script: `(() => {
    document.body.innerHTML = '<input id="draft"><a id="away" href="/no-js">Away</a>'
    addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = '' })
    return 'ready'
  })()` })
  expect(text(prepared)).toBe('ready')
  await electronApp.evaluate(({ dialog }) => {
    const state = globalThis as unknown as { leaveSiteAsked: number, leaveSiteAnswer: number }
    state.leaveSiteAsked = 0
    state.leaveSiteAnswer = 0
    dialog.showMessageBoxSync = () => {
      state.leaveSiteAsked += 1
      return state.leaveSiteAnswer
    }
  })
  const asked = () => electronApp.evaluate(() => (globalThis as unknown as { leaveSiteAsked: number }).leaveSiteAsked)
  const answer = (response: number) => electronApp.evaluate((_electron, response) => {
    (globalThis as unknown as { leaveSiteAnswer: number }).leaveSiteAnswer = response
  }, response)
  // A person's click, as the system sends it, which Playwright's own clicks would wait on a navigation Electron cancelled.
  const personClick = (selector: string) => electronApp.evaluate(async ({ webContents }, { start, selector }) => {
    const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === start)
    if (!page) throw new Error('page not found')
    const rect = await page.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`) as { x: number, y: number }
    const x = Math.round(rect.x)
    const y = Math.round(rect.y)
    page.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    page.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  }, { start, selector })
  const address = () => electronApp.evaluate(({ webContents }, tabUrl) => webContents.getAllWebContents()
    .map(candidate => candidate.getURL()).find(url => url === tabUrl.start || url === tabUrl.destination) ?? '', { start, destination })
  // Keep Playwright from also dismissing the page's question, which would race Electron's own handling.
  for (const candidate of electronApp.context().pages()) candidate.on('dialog', () => undefined)
  // A page may ask only once it was used, as by a click.
  await personClick('#draft')
  const settle = () => new Promise(resolve => setTimeout(resolve, 300))

  // An agent's click keeps the page without asking the person about work they did not start.
  const agentClick = await call('browser_click', { selector: '#away' })
  expect(agentClick.isError, text(agentClick)).not.toBe(true)
  await settle()
  expect(await asked()).toBe(0)
  expect(await address()).toBe(start)

  // Keep editing keeps the page as it was.
  await personClick('#away')
  await expect.poll(asked).toBe(1)
  await settle()
  expect(await address()).toBe(start)

  // Leave page follows the link.
  await answer(1)
  await personClick('#away')
  await expect.poll(asked).toBe(2)
  await expect.poll(address).toBe(destination)
})
