import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

// browser_type reported the text it was given, not what the field held: a number or date field that Chromium leaves
// empty for such text read as typed, and a field the page formatted reported the raw text.

test('browser_type and browser_fill_form report what a field holds and refuse text a field does not take', async ({ capabilities }) => {
  const { client, tabId } = capabilities
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
    await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
  // As JSON, since browser_evaluate gives a string result as it is.
  const evaluate = async (script: string): Promise<unknown> => {
    const result = await call('browser_evaluate', { script: `JSON.stringify(${script})` })
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  const values = () => evaluate("Object.fromEntries([...document.querySelectorAll('input')].map((field) => [field.id, field.value]))")
  await evaluate(`(() => {
    document.body.innerHTML = '<input id="qty" type="number" value="7"><input id="when" type="date"><input id="digits" maxlength="10"><input id="phone">'
      + '<input id="pin" type="password"><input id="first"><input id="locked" disabled>'
    document.querySelector('#phone').addEventListener('input', (event) => {
      event.target.value = event.target.value.replace(/[^0-9]/g, '').replace(/^([0-9]{3})([0-9]{4})$/, '$1-$2')
    })
    document.querySelector('#digits').addEventListener('input', (event) => { event.target.value = event.target.value.replace(/[^0-9]/g, '') })
    // A page that rejects the write and puts back what the person typed.
    document.querySelector('#pin').addEventListener('input', (event) => { event.target.value = 'person-secret' })
    return true
  })()`)

  const number = await call('browser_type', { selector: '#qty', text: 'twelve' })
  expect(number.isError).toBe(true)
  expect(text(number)).toContain('Target is a number input that does not take the text as typed, so nothing was typed. It takes a number such as 12 or 3.5.')
  const date = await call('browser_type', { selector: '#when', text: '03/04/2025' })
  expect(text(date)).toContain('It takes a date such as 2025-03-04.')
  expect(await values()).toMatchObject({ qty: '7', when: '' })
  // A page's handler that drops separators keeps text past maxlength in, as typing key by key does.
  const digits = await call('browser_type', { selector: '#digits', text: '(555) 010-0123' })
  expect(JSON.parse(text(digits))).toMatchObject({ ok: true, value: '5550100123' })
  const pin = await call('browser_type', { selector: '#pin', text: 'x' })
  expect(text(pin)).not.toContain('person-secret')
  expect(JSON.parse(text(pin))).toEqual({ ok: true, tag: 'input', heldDiffers: true })

  const typed = await call('browser_type', { selector: '#when', text: '2025-03-04' })
  expect(typed.isError, text(typed)).not.toBe(true)
  expect(JSON.parse(text(typed))).toMatchObject({ ok: true, value: '2025-03-04' })
  const formatted = await call('browser_type', { selector: '#phone', text: '5550100' })
  expect(JSON.parse(text(formatted))).toMatchObject({ ok: true, value: '555-0100' })

  // An editable region reports the text written, not content its page adds around it.
  await evaluate(`(() => {
    const editor = document.createElement('div')
    editor.id = 'editor'
    editor.contentEditable = 'true'
    editor.textContent = 'old'
    editor.addEventListener('input', () => { editor.append(' and the rest of the document') })
    document.body.append(editor)
    return true
  })()`)
  const edited = await call('browser_type', { selector: '#editor', text: 'new' })
  expect(JSON.parse(text(edited))).toMatchObject({ ok: true, value: 'new' })

  const partly = await call('browser_fill_form', { fields: [{ selector: '#first', value: 'Ada' }, { selector: '#locked', value: 'x' }] })
  expect(partly.isError).toBe(true)
  expect(text(partly)).toContain('Form field 2 is natively disabled; form write rejected. Form field 1 was already filled.')
  expect(await values()).toMatchObject({ first: 'Ada', locked: '' })
  const missing = await call('browser_fill_form', { fields: [{ selector: '#first', value: 'Grace' }, { selector: '#missing', value: 'x' }] })
  expect(text(missing)).toContain('Form field 2 was not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector. Form field 1 was already filled.')
})
