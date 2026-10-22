import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

// browser_wait, browser_scroll, browser_hover, element screenshots and web storage reads ran their page script with a
// user gesture, so a page an agent only waited on, scrolled, hovered or read got a person's activation: it could go full
// screen or ask the person before they left it. In Chrome, waiting, scrolling and moving the mouse never activate a page.

// Playwright's trace snapshots run scripts in each traced page as if the person had clicked, which would hide what
// Hronaut gives the page.
test.use({ trace: 'off' })

test('reading, waiting, scrolling and hovering give the page no activation, and clicks and drags still do', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureOrigin } = capabilities
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
    await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
  // Page script without a user gesture, so the test's own reads activate nothing.
  const page = async (url: string, script: string): Promise<unknown> => await electronApp.evaluate(async ({ webContents }, { url, script }) => {
    const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)
    if (!contents) throw new Error('Page web contents was not found')
    return await contents.executeJavaScript(script, false)
  }, { url, script })
  const cases: Array<{ label: string; tool: string; args: Record<string, unknown>; activates: boolean; fails?: boolean; effect?: string }> = [
    { label: 'wait-text', tool: 'browser_wait', args: { text: 'Ready' }, activates: false },
    { label: 'wait-selector', tool: 'browser_wait', args: { selector: '#target', state: 'visible' }, activates: false },
    { label: 'wait-missing', tool: 'browser_wait', args: { selector: '#never', state: 'attached', timeoutMs: 600 }, activates: false, fails: true },
    { label: 'scroll', tool: 'browser_scroll', args: { deltaY: 300 }, activates: false, effect: 'scrollY > 0' },
    { label: 'hover', tool: 'browser_hover', args: { selector: '#target' }, activates: false, effect: 'window.hovered === true' },
    { label: 'hover-point', tool: 'browser_hover', args: { x: 60, y: 50 }, activates: false, effect: 'window.hovered === true' },
    { label: 'screenshot', tool: 'browser_screenshot', args: { selector: '#target' }, activates: false },
    { label: 'storage', tool: 'browser_storage', args: { kind: 'local-storage', action: 'list' }, activates: false },
    { label: 'click', tool: 'browser_click', args: { selector: '#target' }, activates: true, effect: 'window.clicked === true' },
    { label: 'native-click', tool: 'browser_click', args: { selector: '#target', native: true }, activates: true, effect: 'window.clicked === true' },
    { label: 'drag', tool: 'browser_drag', args: { startX: 60, startY: 50, endX: 160, endY: 50 }, activates: true }
  ]
  for (const { label, tool, args, activates, fails, effect } of cases) {
    const url = `${fixtureOrigin}/?case=${label}`
    const navigated = await call('browser_navigate', { url })
    expect(navigated.isError, text(navigated)).not.toBe(true)
    await page(url, `(() => {
      document.body.insertAdjacentHTML('beforeend', '<p>Ready</p><button id="target" style="position:fixed;left:40px;top:40px">Target</button><div style="height:4000px"></div>')
      const target = document.querySelector('#target')
      target.addEventListener('mouseenter', () => { window.hovered = true })
      target.addEventListener('click', () => { window.clicked = true })
      return true
    })()`)
    expect(await page(url, 'navigator.userActivation.hasBeenActive'), label).toBe(false)
    const result = await call(tool, args)
    expect(result.isError === true, `${label}: ${text(result)}`).toBe(fails === true)
    if (effect) await expect.poll(() => page(url, effect), label).toBe(true)
    expect(await page(url, 'navigator.userActivation.hasBeenActive'), label).toBe(activates)
  }
})
