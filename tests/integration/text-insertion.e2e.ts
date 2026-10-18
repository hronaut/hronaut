import type { ElectronApplication } from '@playwright/test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ISOLATED_WORLDS } from '../../src/main/browser/isolated-worlds.js'
import { textInsertionDisposeScript, textInsertionLocateScript, textInsertionObserveScript, type TextInsertionObservation } from '../../src/main/browser/text-insertion/text-insertion-scripts.js'
import { expect, test, text } from './capability-fixtures.js'

interface EditorPageState {
  events: Array<{ type: string; trusted: boolean; target: string; inputType: string }>
  values: Record<string, string>
  model: string
}

// Editors of each kind, a model-backed editor that applies text itself later, as rich-text frameworks do, one that
// refuses text, a controlled field that resets it, one whose beforeinput moves focus, an editable region with a field
// nested inside, and fields Hronaut must refuse. Every text event the document sees is recorded.
const EDITOR_PAGE = `(() => {
  document.body.innerHTML = '<textarea id="notes" aria-label="Notes">hello world</textarea>'
    + '<input id="name" aria-label="Name" value="Ada">'
    + '<input id="limited" aria-label="Limited" maxlength="5" value="abc">'
    + '<textarea id="short" aria-label="Short" maxlength="5">ab</textarea>'
    + '<input id="locked" aria-label="Locked" readonly value="fixed">'
    + '<fieldset disabled><input id="off" aria-label="Off" value="off"></fieldset>'
    + '<input id="ghost" aria-label="Ghost" style="width:0;height:0;padding:0;border:0">'
    + '<input id="reset" aria-label="Reset">'
    + '<textarea id="jumpy" aria-label="Jumpy">jumpy</textarea>'
    + '<div id="rich" contenteditable="true" aria-label="Rich"><p>abc <b>def</b></p></div>'
    + '<div id="model" contenteditable="true" aria-label="Model editor">Model: </div>'
    + '<div id="refuse" contenteditable="true" aria-label="Refusing editor">Fixed</div>'
    + '<div id="host" contenteditable="true" aria-label="Host">Host <input id="nested" aria-label="Nested"></div>'
    + '<input id="other" aria-label="Other">'
    + '<iframe id="frame" srcdoc="<input id=inner>"></iframe>';
  window.editorEvents = [];
  if (!window.editorRecorders) {
    window.editorRecorders = true;
    for (const type of ['keydown', 'keypress', 'beforeinput', 'textInput', 'input']) {
      document.addEventListener(type, (event) => {
        window.editorEvents.push({ type, trusted: event.isTrusted, target: event.target.id || event.target.tagName, inputType: event.inputType || '' });
      }, true);
    }
  }
  const model = { text: 'Model: ' };
  window.editorModel = model;
  const modelEditor = document.querySelector('#model');
  modelEditor.addEventListener('beforeinput', (event) => {
    if (event.inputType !== 'insertText') return;
    event.preventDefault();
    model.text += event.data;
    setTimeout(() => { modelEditor.textContent = model.text; }, 100);
  });
  document.querySelector('#refuse').addEventListener('beforeinput', (event) => event.preventDefault());
  // A controlled field that rejects every change, as a framework does by restoring its state in the input handler.
  document.querySelector('#reset').addEventListener('input', (event) => { event.target.value = ''; });
  document.querySelector('#jumpy').addEventListener('beforeinput', () => document.getElementById('other').focus());
  return true;
})()`

const STATE = `({
  events: window.editorEvents,
  values: Object.fromEntries(['notes', 'name', 'limited', 'short', 'locked', 'reset', 'jumpy', 'nested', 'other'].map((id) => [id, document.getElementById(id).value])
    .concat(['rich', 'model', 'refuse'].map((id) => [id, document.getElementById(id).textContent]))
    .concat([['inner', document.getElementById('frame').contentDocument.getElementById('inner').value]])),
  model: window.editorModel.text
})`

async function onPage<T>(app: ElectronApplication, url: string, script: string, world?: number): Promise<T> {
  return app.evaluate(async ({ webContents }, { url, script, world }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    if (!page) throw new Error('Missing editor fixture page')
    return (world === undefined ? page.executeJavaScript(script) : page.executeJavaScriptInIsolatedWorld(world, [{ code: script }])) as Promise<T>
  }, { url, script, world })
}

/** Sends text to the page as Hronaut does, through Chromium's native text input. */
async function sendNativeText(app: ElectronApplication, url: string, value: string): Promise<void> {
  await app.evaluate(async ({ webContents }, { url, value }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
    const attached = page.debugger.isAttached()
    if (!attached) page.debugger.attach('1.3')
    try {
      await page.debugger.sendCommand('Input.insertText', { text: value })
    } finally {
      if (!attached) page.debugger.detach()
    }
  }, { url, value })
}

const caretScript = (id: string, start: number, end = start) => `(() => {
  const element = document.getElementById(${JSON.stringify(id)});
  element.focus();
  element.setSelectionRange(${start}, ${end});
  window.editorEvents = [];
  return true;
})()`

const richCaretScript = (id: string, path: string, offset: number) => `(() => {
  const host = document.getElementById(${JSON.stringify(id)});
  host.focus();
  const node = ${path};
  const range = document.createRange();
  range.setStart(node, ${offset});
  range.collapse(true);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  window.editorEvents = [];
  return true;
})()`

test('inserts text natively at the caret of a focused editor, reports what the editor did, and refuses editors that are not ready', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await onPage(electronApp, fixtureUrl, EDITOR_PAGE)
  const insert = (args: Record<string, unknown>) => client.callTool({ name: 'browser_insert_text', arguments: { tabId, ...args } }) as Promise<CallToolResult>
  const state = () => onPage<EditorPageState>(electronApp, fixtureUrl, STATE)

  // A selected word in a textarea is replaced, keeping the rest; Unicode beyond the BMP arrives whole.
  await onPage(electronApp, fixtureUrl, caretScript('notes', 6, 11))
  const replaced = await insert({ selector: '#notes', text: 'there 😀 мир' })
  expect(replaced.isError, text(replaced)).not.toBe(true)
  expect(JSON.parse(text(replaced))).toMatchObject({ status: 'INSERTED', editor: 'textarea', insertedBy: 'browser' })
  expect(text(replaced)).not.toContain('мир')
  let page = await state()
  expect(page.values.notes).toBe('hello there 😀 мир')
  // Text committed as from an input method: trusted text events on the editor, and no key events.
  expect(page.events.map(event => event.type)).toEqual(['beforeinput', 'textInput', 'input'])
  expect(page.events.every(event => event.trusted && event.target === 'notes')).toBe(true)
  expect(page.events.find(event => event.type === 'beforeinput')?.inputType).toBe('insertText')

  // Line breaks go into a textarea at the caret, here its end, found by a snapshot ref.
  await onPage(electronApp, fixtureUrl, caretScript('notes', 'hello there 😀 мир'.length))
  const snapshot = text(await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult)
  const ref = /\[(e\d+)\] textarea "Notes"/u.exec(snapshot)?.[1]
  expect(ref, snapshot).toBeTruthy()
  expect(JSON.parse(text(await insert({ ref, text: '\nsecond\tline' })))).toMatchObject({ status: 'INSERTED' })
  expect((await state()).values.notes).toBe('hello there 😀 мир\nsecond\tline')

  // An editable region takes the text at its caret, inside the formatting around it.
  await onPage(electronApp, fixtureUrl, richCaretScript('rich', "host.querySelector('p').firstChild", 4))
  expect(JSON.parse(text(await insert({ selector: '#rich b', text: 'NEW ' })))).toMatchObject({ status: 'INSERTED', editor: 'contenteditable', insertedBy: 'browser' })
  page = await state()
  // Chromium keeps a space at a text node's edge visible as a no-break space, as for a person's typing.
  expect(page.values.rich?.replace(/\u00a0/gu, ' ')).toBe('abc NEW def')
  // The text's events go to the editing host itself, the focused element, not to the node holding the caret.
  expect(page.events.map(event => event.type)).toEqual(['beforeinput', 'textInput', 'input'])
  expect(page.events.every(event => event.trusted && event.target === 'rich')).toBe(true)

  // An editor that cancels the native insertion and applies the text to its own model later is reported as such.
  await onPage(electronApp, fixtureUrl, richCaretScript('model', 'host.firstChild', 7))
  expect(JSON.parse(text(await insert({ selector: '#model', text: 'typed' })))).toMatchObject({ status: 'INSERTED', insertedBy: 'editor' })
  page = await state()
  expect(page.model).toBe('Model: typed')
  expect(page.values.model).toBe('Model: typed')

  // An editor that refuses the text keeps its content and says so.
  await onPage(electronApp, fixtureUrl, richCaretScript('refuse', 'host.firstChild', 5))
  expect(JSON.parse(text(await insert({ selector: '#refuse', text: 'more' })))).toMatchObject({ status: 'NOT_ACCEPTED', note: expect.stringContaining('cancelled it') })
  expect((await state()).values.refuse).toBe('Fixed')

  // A controlled field that took the text and reset it may have kept it elsewhere: unconfirmed, never safe to retry.
  await onPage(electronApp, fixtureUrl, caretScript('reset', 0))
  expect(JSON.parse(text(await insert({ selector: '#reset', text: 'gone' })))).toMatchObject({ status: 'UNCONFIRMED', editor: 'input', note: expect.stringContaining('back to what it was') })
  expect((await state()).values.reset).toBe('')

  // An editor whose beforeinput moves focus: the insertion Chromium then aims at the new element is cancelled there.
  await onPage(electronApp, fixtureUrl, caretScript('jumpy', 5))
  expect(JSON.parse(text(await insert({ selector: '#jumpy', text: 'away' })))).toMatchObject({ status: 'BLOCKED' })
  page = await state()
  expect(page.values).toMatchObject({ jumpy: 'jumpy', other: '' })

  // Text a length limit would cut short is refused before anything is sent; with the selection replaced it fits.
  await onPage(electronApp, fixtureUrl, caretScript('limited', 3))
  const limited = await insert({ selector: '#limited', text: 'zzz' })
  expect(limited.isError, text(limited)).toBe(true)
  expect(text(limited)).toMatch(/length limit \(maxlength\)/u)
  expect((await state()).events).toEqual([])
  await onPage(electronApp, fixtureUrl, caretScript('limited', 2, 3))
  expect(JSON.parse(text(await insert({ selector: '#limited', text: 'zzz' })))).toMatchObject({ status: 'INSERTED', editor: 'input' })
  expect((await state()).values.limited).toBe('abzzz')
  // A line break counts as one character toward a textarea's limit, as Hronaut counts it, so nothing is cut short.
  await onPage(electronApp, fixtureUrl, caretScript('short', 2))
  expect(JSON.parse(text(await insert({ selector: '#short', text: 'c\nd' })))).toMatchObject({ status: 'INSERTED', editor: 'textarea' })
  expect((await state()).values.short).toBe('abc\nd')

  // Editors that are not ready are refused before any text is sent, and nothing lands elsewhere.
  const refusals: Array<[string, Record<string, unknown>, RegExp]> = [
    [caretScript('other', 0), { selector: '#name', text: 'x' }, /does not have focus/u],
    [caretScript('locked', 0), { selector: '#locked', text: 'x' }, /read-only/u],
    [caretScript('name', 3), { selector: '#off', text: 'x' }, /disabled/u],
    [caretScript('ghost', 0), { selector: '#ghost', text: 'x' }, /hidden or has no size/u],
    [caretScript('name', 3), { selector: '#name', text: 'a\nb' }, /single-line field/u],
    [caretScript('name', 3), { selector: 'input', text: 'x' }, /more than one element/u],
    [caretScript('name', 3), { selector: '#inner', text: 'x' }, /Editor not found/u],
    [caretScript('name', 3), { selector: '#name', text: 'bell\u0007' }, /control characters/u]
  ]
  for (const [setup, args, message] of refusals) {
    await onPage(electronApp, fixtureUrl, setup)
    const refused = await insert(args)
    expect(refused.isError, text(refused)).toBe(true)
    expect(text(refused)).toMatch(message)
    expect((await state()).events, String(message)).toEqual([])
  }
  page = await state()
  expect(page.values).toMatchObject({ name: 'Ada', other: '', locked: 'fixed', inner: '' })

  // A locked tab blocks the person's input, not the agent's.
  await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, true)`)
  try {
    await onPage(electronApp, fixtureUrl, caretScript('name', 3))
    expect(JSON.parse(text(await insert({ selector: '#name', text: ' Lovelace' })))).toMatchObject({ status: 'INSERTED' })
    expect((await state()).values.name).toBe('Ada Lovelace')
  } finally {
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, false)`)
  }
})

test('the guard cancels text aimed anywhere else in the page once armed, and reports focus that left for a frame', async ({ capabilities, electronApp }) => {
  const { fixtureUrl } = capabilities
  await onPage(electronApp, fixtureUrl, EDITOR_PAGE)
  const world = ISOLATED_WORLDS.textInsertion
  const state = () => onPage<EditorPageState>(electronApp, fixtureUrl, STATE)
  // The page scripts the tool runs, with the focus change between arming and the text that a busy page could make.
  const armed = async (token: string, editor: string, moveFocus: string, kind = 'textarea'): Promise<TextInsertionObservation> => {
    const target = { selector: `#${editor}` }
    const shape = { length: 'stolen'.length, lineBreaks: false }
    expect(await onPage(electronApp, fixtureUrl, textInsertionLocateScript(target, token, 'check', shape), world)).toEqual({ editor: kind })
    expect(await onPage(electronApp, fixtureUrl, textInsertionLocateScript(target, token, 'arm', shape), world)).toEqual({ editor: kind })
    await onPage(electronApp, fixtureUrl, moveFocus)
    await sendNativeText(electronApp, fixtureUrl, 'stolen')
    return onPage<TextInsertionObservation>(electronApp, fixtureUrl, textInsertionObserveScript(token), world)
  }

  // Focus moved to another field: Chromium aims the text there, and the guard cancels it.
  await onPage(electronApp, fixtureUrl, caretScript('notes', 0))
  const moved = await armed('moved', 'notes', "document.getElementById('other').focus(); true")
  expect(moved).toMatchObject({ current: true, reached: false, changed: false, focusLeft: true })
  expect(moved.blocked).toBeGreaterThan(0)
  let page = await state()
  expect(page.values).toMatchObject({ notes: 'hello world', other: '' })
  expect(page.events.filter(event => event.type === 'input')).toEqual([])

  // Focus dropped to the body: Chromium would still insert at the editor's old selection, through a textInput on the body.
  await onPage(electronApp, fixtureUrl, caretScript('notes', 0))
  const dropped = await armed('dropped', 'notes', "document.getElementById('notes').blur(); true")
  expect(dropped).toMatchObject({ reached: false, changed: false, focusLeft: true })
  expect(dropped.blocked).toBeGreaterThan(0)
  expect((await state()).values.notes).toBe('hello world')

  // Focus moved into a field nested inside the editor: still not the editor, so the guard cancels the text there too.
  await onPage(electronApp, fixtureUrl, richCaretScript('host', 'host.firstChild', 5))
  const nested = await armed('nested', 'host', "document.getElementById('nested').focus(); true", 'contenteditable')
  expect(nested).toMatchObject({ reached: false, changed: false, focusLeft: true })
  expect(nested.blocked).toBeGreaterThan(0)
  expect((await state()).values.nested).toBe('')

  // Focus that moved into a frame is out of the guard's reach: the editor got nothing, and the observation says focus left.
  await onPage(electronApp, fixtureUrl, caretScript('notes', 0))
  expect(await armed('frame', 'notes', "document.getElementById('frame').contentDocument.getElementById('inner').focus(); true"))
    .toMatchObject({ reached: false, changed: false, blocked: 0, focusLeft: true })
  page = await state()
  expect(page.values.notes).toBe('hello world')
  // This is the limit the tool reports as UNCONFIRMED: the text reached the frame.
  expect(page.values.inner).toBe('stolen')

  // Disarmed, the guard no longer touches the page's input, and disposing it leaves no record behind.
  await onPage(electronApp, fixtureUrl, caretScript('other', 0))
  await sendNativeText(electronApp, fixtureUrl, 'free')
  expect((await state()).values.other).toBe('free')
  for (const token of ['moved', 'dropped', 'nested', 'frame']) await onPage(electronApp, fixtureUrl, textInsertionDisposeScript(token), world)
  expect(await onPage(electronApp, fixtureUrl, 'globalThis.__hronautTextInsertions.size', world)).toBe(0)
})
