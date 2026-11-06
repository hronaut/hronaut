import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

// On Windows and Linux an agent's Control+V, Shift+Insert or Control+Shift+V pasted the person's clipboard into its
// page, where the page and the agent could read it, and its Control+C or Control+X replaced what they had copied.

test('browser_press cannot paste, copy or cut through the person\'s clipboard', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const refuses = process.platform !== 'darwin'
  const page = async <T>(script: string) => await electronApp.evaluate(async ({ webContents }, { url, script }) => {
    const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
    return await contents.executeJavaScript(script) as unknown
  }, { url: fixtureUrl, script }) as T
  const clipboardText = async () => await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  const press = async (key: string) => await client.callTool({ name: 'browser_press', arguments: { tabId, key } }) as CallToolResult
  await electronApp.evaluate(({ clipboard }) => { clipboard.writeText('copied by the person') })
  await page(`document.body.innerHTML = '<textarea id="field"></textarea><p id="words">written by the page</p>'
    window.clipboardEvents = []
    for (const type of ['paste', 'copy', 'cut']) document.addEventListener(type, () => { window.clipboardEvents.push(type) })
    document.querySelector('#field').focus()
    void 0`)

  for (const key of ['Control+V', 'Shift+Insert', 'Control+Shift+V']) {
    const result = await press(key)
    if (refuses) {
      expect(result.isError, key).toBe(true)
      expect(text(result)).toContain('use browser_insert_text')
    }
  }
  if (refuses) expect(await page('document.querySelector("#field").value')).toBe('')
  // Other keys go on as before.
  expect((await press('v')).isError).not.toBe(true)
  await expect.poll(() => page('document.querySelector("#field").value')).toBe('v')

  await page('getSelection().selectAllChildren(document.querySelector("#words")); void 0')
  for (const key of ['Control+C', 'Control+Insert', 'Control+X', 'Shift+Delete']) {
    const result = await press(key)
    if (refuses) expect(result.isError, key).toBe(true)
  }
  if (refuses) {
    expect(await clipboardText()).toBe('copied by the person')
    expect(await page('window.clipboardEvents')).toEqual([])
  }
})
