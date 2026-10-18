import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

interface FieldPageState {
  events: Array<{ type: string; target: string }>
  values: Record<string, string>
}

// Plain fields, one whose input handler rewrites its value, fields Hronaut must refuse, and a frame. Every input,
// change and key event the document sees is recorded.
const FIELD_PAGE = `(() => {
  document.body.innerHTML = '<textarea id="notes" aria-label="Notes">old notes</textarea>'
    + '<input id="title" aria-label="Title" value="old title">'
    + '<input id="upper" aria-label="Upper" value="">'
    + '<input id="short" aria-label="Short" maxlength="5" value="">'
    + '<input id="secret" type="password" aria-label="Secret">'
    + '<input id="email" type="email" aria-label="Email">'
    + '<div id="rich" contenteditable="true" aria-label="Rich">rich</div>'
    + '<input id="off" aria-label="Off" disabled value="off">'
    + '<input id="locked" aria-label="Locked" readonly value="locked">'
    + '<input id="ghost" aria-label="Ghost" style="width:0;height:0;padding:0;border:0">'
    + '<input class="twin" aria-label="Twin one"><input class="twin" aria-label="Twin two">'
    + '<iframe id="frame" srcdoc="<input id=inner>"></iframe>';
  window.fieldEvents = [];
  if (!window.fieldRecorders) {
    window.fieldRecorders = true;
    for (const type of ['keydown', 'beforeinput', 'input', 'change']) {
      document.addEventListener(type, (event) => { window.fieldEvents.push({ type, target: event.target.id || event.target.className }); }, true);
    }
  }
  document.querySelector('#upper').addEventListener('input', (event) => { event.target.value = event.target.value.toUpperCase(); });
  return true;
})()`

const STATE = `({
  events: window.fieldEvents,
  values: Object.fromEntries(['notes', 'title', 'upper', 'short', 'secret', 'email', 'off', 'locked', 'ghost'].map((id) => [id, document.getElementById(id).value])
    .concat([['rich', document.getElementById('rich').textContent], ['inner', document.getElementById('frame').contentDocument.getElementById('inner').value]]))
})`

async function onPage<T>(app: ElectronApplication, url: string, script: string): Promise<T> {
  return app.evaluate(async ({ webContents }, { url, script }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    if (!page) throw new Error('Missing field fixture page')
    return page.executeJavaScript(script) as Promise<T>
  }, { url, script })
}

test('fills plain fields with the exact text of local files, reports a page that rewrites it, and refuses what it cannot fill faithfully', async ({ capabilities, electronApp, profileDirectory }) => {
  const { client, tabId, fixtureUrl, fixtureOrigin } = capabilities
  await onPage(electronApp, fixtureUrl, FIELD_PAGE)
  const directory = join(profileDirectory, 'private-path-canary')
  await mkdir(directory, { recursive: true })
  const file = async (name: string, content: string | Buffer): Promise<string> => {
    const path = join(directory, name)
    await writeFile(path, content)
    return path
  }
  const fill = (args: Record<string, unknown>) =>
    client.callTool({ name: 'browser_fill_from_file', arguments: { tabId, expectedOrigin: fixtureOrigin, ...args } }) as Promise<CallToolResult>
  const state = () => onPage<FieldPageState>(electronApp, fixtureUrl, STATE)
  const clearEvents = () => onPage(electronApp, fixtureUrl, 'window.fieldEvents = []; true')

  // A long synthetic text with quotes, backticks, non-Latin script, emoji and a terminal line break lands whole.
  const line = 'private-fixture-canary "quoted" \'single\' `tick` ${not} мир 世界 😀\ttab\n'
  const long = line.repeat(Math.ceil(20_000 / line.length)).slice(0, 19_999) + '\n'
  const longPath = await file('long.txt', long)
  await clearEvents()
  const filled = await fill({ selector: '#notes', path: longPath })
  expect(filled.isError, text(filled)).not.toBe(true)
  expect(JSON.parse(text(filled))).toMatchObject({ status: 'MATCHED', field: 'textarea', characters: long.length })
  expect(text(filled)).not.toMatch(/private-fixture-canary|private-path-canary/u)
  let page = await state()
  expect(page.values.notes).toBe(long)
  // Set as browser_type sets a value: input and change, and no key events.
  expect(page.events).toEqual([{ type: 'input', target: 'notes' }, { type: 'change', target: 'notes' }])

  // A generated identifier goes into a text input found by its snapshot ref, bound to the file's SHA-256.
  const identifier = 'id_7Gq9-Zx2_kP0vL5rT8wY3nB6mC1aD4eF'
  const identifierPath = await file('identifier.txt', identifier)
  const snapshot = text(await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult)
  const ref = /\[(e\d+)\] [a-z]+ "Title"/u.exec(snapshot)?.[1]
  expect(ref, snapshot).toBeTruthy()
  const sha256 = createHash('sha256').update(identifier).digest('hex')
  expect(JSON.parse(text(await fill({ ref, path: identifierPath, sha256 })))).toMatchObject({ status: 'MATCHED', field: 'input', characters: identifier.length })
  expect((await state()).values.title).toBe(identifier)

  // A page whose handler rewrites the value: the field does not hold the file's text, and the result says so.
  const lowerPath = await file('lower.txt', 'make me loud')
  expect(JSON.parse(text(await fill({ selector: '#upper', path: lowerPath })))).toMatchObject({ status: 'MISMATCH', field: 'input', characters: 12, fieldCharacters: 12 })
  expect((await state()).values.upper).toBe('MAKE ME LOUD')

  // Targets, files and pages it cannot fill faithfully are refused before anything is written.
  const shortPath = await file('short.txt', 'abc')
  const tooLongPath = await file('too-long.txt', 'abcdef')
  const multiLinePath = await file('lines.txt', 'one\ntwo')
  const refusals: Array<[Record<string, unknown>, RegExp]> = [
    [{ selector: '#secret', path: shortPath }, /not a plain text input or a textarea/u],
    [{ selector: '#email', path: shortPath }, /not a plain text input or a textarea/u],
    [{ selector: '#rich', path: shortPath }, /not a plain text input or a textarea/u],
    [{ selector: '#off', path: shortPath }, /disabled/u],
    [{ selector: '#locked', path: shortPath }, /read-only/u],
    [{ selector: '#ghost', path: shortPath }, /hidden or has no size/u],
    [{ selector: '.twin', path: shortPath }, /more than one element/u],
    [{ selector: '#inner', path: shortPath }, /Field not found/u],
    [{ selector: '#short', path: tooLongPath }, /length limit \(maxlength\)/u],
    [{ selector: '#short', path: multiLinePath }, /drops line breaks/u],
    [{ selector: '#short', path: shortPath, expectedOrigin: 'https://elsewhere.example' }, /not at expectedOrigin/u],
    [{ selector: '#short', path: shortPath, sha256: createHash('sha256').update('other').digest('hex') }, /does not match sha256/u],
    [{ selector: '#short', path: join(directory, 'missing.txt') }, /cannot be read/u],
    [{ selector: '#short', path: 'relative.txt' }, /must be absolute/u],
    [{ selector: '#short', path: await file('empty.txt', '') }, /empty/u],
    [{ selector: '#short', path: await file('binary.txt', Buffer.from([0x61, 0xff])) }, /not valid UTF-8/u],
    [{ selector: '#short', path: await file('crlf.txt', 'a\r\nb') }, /carriage returns/u],
    [{ selector: '#short', path: await file('large.txt', 'a'.repeat(64 * 1024 + 1)) }, /larger than 64 KiB/u]
  ]
  for (const [args, message] of refusals) {
    await clearEvents()
    const refused = await fill(args)
    expect(refused.isError, text(refused)).toBe(true)
    expect(text(refused)).toMatch(message)
    expect(text(refused)).not.toContain('private-path-canary')
    expect((await state()).events, String(message)).toEqual([])
  }
  page = await state()
  expect(page.values).toMatchObject({ short: '', secret: '', email: '', rich: 'rich', off: 'off', locked: 'locked', ghost: '', inner: '' })

  // A field length limit that fits takes the text.
  expect(JSON.parse(text(await fill({ selector: '#short', path: shortPath })))).toMatchObject({ status: 'MATCHED' })
  expect((await state()).values.short).toBe('abc')
})
