import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

// An agent's click on a file field opened the system's file chooser over the person's window, a dialog that holds
// Hronaut until the person closes it, for a page they may not even see. The agent's click now cancels the chooser, as
// the page learns from the field's cancel event, and the agent uploads with browser_file_upload instead.
test.use({ trace: 'off' })

test('an agent\'s click on a file field opens no file chooser, and the field hears it was cancelled', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureOrigin } = capabilities
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
    await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
  const page = async (url: string, script: string): Promise<unknown> => await electronApp.evaluate(async ({ webContents }, { url, script }) => {
    const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)
    if (!contents) throw new Error('Page web contents was not found')
    return await contents.executeJavaScript(script, false)
  }, { url, script })
  // Twice: each of the agent's inputs cancels its own chooser.
  for (const round of [1, 2]) {
    const url = `${fixtureOrigin}/?file-chooser=${round}`
    const navigated = await call('browser_navigate', { url })
    expect(navigated.isError, text(navigated)).not.toBe(true)
    await page(url, `(() => {
      document.body.insertAdjacentHTML('beforeend', '<input id="file" type="file" style="position:fixed;left:40px;top:40px;width:200px;height:40px">')
      window.cancelled = 0
      document.querySelector('#file').addEventListener('cancel', () => { window.cancelled += 1 })
      return true
    })()`)
    const clicked = await call('browser_click', { selector: '#file' })
    expect(clicked.isError === true, text(clicked)).toBe(false)
    await expect.poll(() => page(url, 'window.cancelled'), `round ${round}`).toBe(1)
  }
})
