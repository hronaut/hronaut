import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

// An agent's Control+V, Shift+Insert, Control+Shift+V or Paste key pasted the person's clipboard into its page, where
// the page and the agent could read it, such as a password they had copied.

test('browser_press cannot paste the person\'s clipboard, and still copies as before', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const page = async <T>(script: string) => await electronApp.evaluate(async ({ webContents }, { url, script }) => {
    const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
    return await contents.executeJavaScript(script) as unknown
  }, { url: fixtureUrl, script }) as T
  const press = async (key: string) => await client.callTool({ name: 'browser_press', arguments: { tabId, key } }).then(
    result => result as CallToolResult,
    (error: unknown) => ({ isError: true, content: [{ type: 'text', text: String(error) }] }) as CallToolResult
  )
  await electronApp.evaluate(({ clipboard }) => { clipboard.writeText('copied by the person') })
  await page(`document.body.innerHTML = '<textarea id="field"></textarea><p id="words">written by the page</p>'
    window.pasted = 0
    document.addEventListener('paste', () => { window.pasted++ })
    document.querySelector('#field').focus()
    void 0`)

  // Control+V and Control+Shift+V paste on Windows and Linux; macOS pastes from its menu, which no agent key reaches.
  const pastes = (key: string) => process.platform !== 'darwin' || key === 'Shift+Insert' || key === 'Paste'
  for (const key of ['Control+V', 'Shift+Insert', 'Control+Shift+V', 'Paste']) {
    const result = await press(key)
    if (pastes(key)) {
      expect(result.isError, key).toBe(true)
      expect(text(result)).toContain('use browser_insert_text')
    } else {
      expect(result.isError, key).not.toBe(true)
    }
  }
  expect(await page('document.querySelector("#field").value')).toBe('')
  expect(await page('window.pasted')).toBe(0)
  expect((await press('v')).isError).not.toBe(true)
  await expect.poll(() => page('document.querySelector("#field").value')).toBe('v')

  // Copy keys go on as before, as a web terminal's Control+C does.
  if (process.platform !== 'darwin') {
    await page('getSelection().selectAllChildren(document.querySelector("#words")); void 0')
    expect((await press('Control+C')).isError).not.toBe(true)
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe('written by the page')
  }
})
