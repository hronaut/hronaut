import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

// browser_press Enter and Space sent the key without its character, so Enter in a form's field did not submit it, Enter
// in a text area added no line or pressed no focused button, and Space typed no space, though each reported success.

test('browser_press Enter and Space submit, type and press buttons as a keyboard does', async ({ capabilities }) => {
  const { client, tabId } = capabilities
  const evaluate = async (script: string): Promise<unknown> => {
    // As JSON, since browser_evaluate gives a string result as it is.
    const result = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: `JSON.stringify(${script})` } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  const press = async (key: string): Promise<void> => {
    const result = await client.callTool({ name: 'browser_press', arguments: { tabId, key } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
  }
  await evaluate(`(() => {
    document.body.innerHTML = '<form id="form"><input id="query"></form><textarea id="notes"></textarea><input id="field"><button id="button" type="button">Go</button>'
    window.seen = { submits: 0, clicks: 0 }
    document.querySelector('#form').addEventListener('submit', (event) => { event.preventDefault(); window.seen.submits++ })
    document.querySelector('#button').addEventListener('click', () => { window.seen.clicks++ })
    return true
  })()`)

  await evaluate("(document.querySelector('#query').focus(), true)")
  await press('Enter')
  await expect.poll(() => evaluate('window.seen.submits')).toBe(1)
  // Any case names the key, as `enter` reached the page as a key without a name.
  await press('enter')
  await expect.poll(() => evaluate('window.seen.submits')).toBe(2)

  await evaluate("(document.querySelector('#notes').focus(), true)")
  await press('Enter')
  await press('Shift+Enter')
  await expect.poll(() => evaluate("document.querySelector('#notes').value")).toBe('\n\n')

  await evaluate("(document.querySelector('#field').focus(), true)")
  await press('a')
  await press('Space')
  await press('b')
  await expect.poll(() => evaluate("document.querySelector('#field').value")).toBe('a b')

  await evaluate("(document.querySelector('#button').focus(), true)")
  await press('Enter')
  await expect.poll(() => evaluate('window.seen.clicks')).toBe(1)
  // Space pressed a focused button before too, on its key up; it still does once it types its character.
  await press('Space')
  await expect.poll(() => evaluate('window.seen.clicks')).toBe(2)
  expect(await evaluate('window.seen.submits')).toBe(2)
})

// The press checked the page once the key was up, so Enter that submitted a form to another page, or a form a web app
// handles with history.pushState, reported an error though the form went in.
test('browser_press Enter reports success when the form it submits navigates the page', async ({ capabilities }) => {
  const { client, tabId, fixtureOrigin } = capabilities
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
    await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
  const evaluate = async (script: string): Promise<unknown> => {
    const result = await call('browser_evaluate', { script: `JSON.stringify(${script})` })
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  const navigated = await call('browser_navigate', { url: `${fixtureOrigin}/?press=form` })
  expect(navigated.isError, text(navigated)).not.toBe(true)

  await evaluate(`(() => {
    document.body.innerHTML = '<form action="/" method="get"><input id="query" name="q" value="hronaut"></form>'
    document.querySelector('#query').focus()
    return true
  })()`)
  const submitted = await call('browser_press', { key: 'Enter' })
  expect(submitted.isError, text(submitted)).not.toBe(true)
  expect(text(submitted)).toBe('Pressed Enter')
  await expect.poll(() => evaluate('location.search')).toBe('?q=hronaut')

  await evaluate(`(() => {
    document.body.innerHTML = '<form id="form"><input id="query"></form>'
    document.querySelector('#form').addEventListener('submit', (event) => { event.preventDefault(); history.pushState({}, '', '/?press=app') })
    document.querySelector('#query').focus()
    return true
  })()`)
  const pushed = await call('browser_press', { key: 'Enter' })
  expect(pushed.isError, text(pushed)).not.toBe(true)
  expect(await evaluate('location.search')).toBe('?press=app')
})
