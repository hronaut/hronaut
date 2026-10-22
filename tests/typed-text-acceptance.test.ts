// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fillFormScript, targetActionScript } from '../src/main/browser/page-scripts.js'
import { assertFormFieldWritten, assertNativeEditability, assertTypedTextAccepted } from '../src/main/browser/input-targets/target-checks.js'

// browser_type and browser_fill_form set a field's value directly and reported the text they were given: a number or
// date field left empty by text it does not take read as typed, and a field the page formatted reported the raw text.

const cleanups: Array<() => void> = []
beforeEach(() => { Element.prototype.scrollIntoView = () => undefined })
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  document.body.replaceChildren()
})

function type(selector: string, text: string): unknown {
  const result = window.eval(targetActionScript('type', { selector }, text)) as unknown
  assertNativeEditability(result)
  assertTypedTextAccepted(result)
  return result
}

function fill(fields: Array<{ selector: string; value: string | boolean }>): unknown {
  const result = window.eval(fillFormScript(fields)) as unknown
  assertNativeEditability(result)
  assertTypedTextAccepted(result)
  assertFormFieldWritten(result)
  return result
}

function events(): string[] {
  const seen: string[] = []
  const record = (event: Event): void => { seen.push(`${(event.target as Element).id}:${event.type}`) }
  for (const kind of ['input', 'change']) {
    document.addEventListener(kind, record, true)
    cleanups.push(() => document.removeEventListener(kind, record, true))
  }
  return seen
}

describe('typed text a field does not take, and what a field holds', () => {
  it.each([
    ['number', 'twelve', 'It takes a number such as 12 or 3.5.'],
    ['date', '03/04/2025', 'It takes a date such as 2025-03-04.'],
    ['time', 'quarter past one', 'It takes a time such as 13:45.']
  ])('leaves a %s field as it was and says what it takes', (inputType, text, format) => {
    document.body.innerHTML = `<input id="field" type="${inputType}">`
    const seen = events()
    expect(() => type('#field', text)).toThrow(`Target is a ${inputType} input that does not take the text as typed, so nothing was typed. ${format}`)
    expect((document.querySelector('#field') as HTMLInputElement).value).toBe('')
    expect(seen).toEqual([])
  })

  it('keeps the value a field held before, and leaves the field as the page set it', () => {
    document.body.innerHTML = '<input id="field" type="number" value="7">'
    const field = document.querySelector('#field') as HTMLInputElement
    expect(() => type('#field', 'seven')).toThrow('Target is a number input')
    expect(field.value).toBe('7')
    // Still untouched, so the page's default value still shows.
    field.setAttribute('value', '9')
    expect(field.value).toBe('9')
  })

  it('leaves text past maxlength to the page, whose handler may shorten it as typing does', () => {
    document.body.innerHTML = '<input id="digits" maxlength="10">'
    document.querySelector('#digits')!.addEventListener('input', (event) => {
      const field = event.target as HTMLInputElement
      field.value = field.value.replace(/\D/g, '')
    })
    expect(type('#digits', '(555) 010-0123')).toMatchObject({ ok: true, value: '5550100123' })
  })

  it('reports text as the field holds it', () => {
    document.body.innerHTML = '<input id="code"><textarea id="note"></textarea>'
    expect(type('#code', 'ab\ncd')).toMatchObject({ ok: true, value: 'abcd' })
    expect(type('#note', 'a\r\nb')).toMatchObject({ ok: true, value: 'a\nb' })
  })

  it('reads what the field holds, not what the page says through its own value property', () => {
    document.body.innerHTML = '<input id="phone">'
    const field = document.querySelector('#phone') as HTMLInputElement
    const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
    Object.defineProperty(field, 'value', {
      configurable: true,
      get() { return String(native.get!.call(this)).replace(/\D/g, '') },
      set(value: string) { native.set!.call(this, value) }
    })
    expect(type('#phone', '(555) 010-0123')).toMatchObject({ ok: true, value: '(555) 010-0123' })
  })

  it('never returns a secret the page put back in place of the typed text', () => {
    document.body.innerHTML = '<input id="pin" type="password"><input id="otp" autocomplete="one-time-code"><input id="pass" type="password">'
    for (const id of ['pin', 'otp']) {
      document.querySelector(`#${id}`)!.addEventListener('input', (event) => { (event.target as HTMLInputElement).value = '4821' })
    }
    for (const id of ['pin', 'otp']) {
      const result = type(`#${id}`, 'x')
      expect(result).toEqual({ ok: true, tag: 'input', heldDiffers: true })
    }
    expect(type('#pass', 'typed-by-agent')).toEqual({ ok: true, tag: 'input', value: 'typed-by-agent' })
  })

  it('types text a field takes and reports what the field holds after the page formats it', () => {
    document.body.innerHTML = '<input id="when" type="date"><input id="qty" type="number"><input id="phone">'
    document.querySelector('#phone')!.addEventListener('input', (event) => {
      const field = event.target as HTMLInputElement
      field.value = field.value.replace(/\D/g, '').replace(/^(\d{3})(\d{4})$/, '$1-$2')
    })
    expect(type('#when', '2025-03-04')).toMatchObject({ ok: true, value: '2025-03-04' })
    expect(type('#qty', '3.5')).toMatchObject({ ok: true, value: '3.5' })
    expect(type('#phone', '5550100')).toMatchObject({ ok: true, value: '555-0100' })
  })

  it.each([
    ['datetime-local', '2025-03-04T13:45:00', '2025-03-04T13:45'],
    ['time', '13:45:30', '13:45:30'],
    ['number', '1e3', '1e3']
  ])('takes text a %s field writes in its own way', (inputType, text, held) => {
    document.body.innerHTML = `<input id="field" type="${inputType}">`
    expect(type('#field', text)).toMatchObject({ ok: true, value: held })
  })

  // A color or range field always holds a value, so it reports the one it chose instead of being refused.
  it('reports the value a color or range field keeps', () => {
    document.body.innerHTML = '<input id="tint" type="color"><input id="level" type="range" min="0" max="100" value="20">'
    expect(type('#tint', '#FF8800')).toMatchObject({ ok: true, value: '#ff8800' })
    expect(type('#tint', 'orange')).toMatchObject({ ok: true, value: '#000000' })
    expect(type('#level', '30')).toMatchObject({ ok: true, value: '30' })
    expect(type('#level', '150')).toMatchObject({ ok: true, value: '100' })
  })

})

describe('a form fill refused part way', () => {
  it('says which fields were already filled', () => {
    document.body.innerHTML = '<input id="first"><input id="second"><input id="qty" type="number"><input id="last">'
    expect(() => fill([
      { selector: '#first', value: 'Ada' },
      { selector: '#second', value: 'Lovelace' },
      { selector: '#qty', value: 'many' },
      { selector: '#last', value: 'x' }
    ])).toThrow('Form field 3 is a number input that does not take the text as typed, so nothing was typed. It takes a number such as 12 or 3.5. Form fields 1–2 were already filled.')
    expect((document.querySelector('#first') as HTMLInputElement).value).toBe('Ada')
    expect((document.querySelector('#qty') as HTMLInputElement).value).toBe('')
    expect((document.querySelector('#last') as HTMLInputElement).value).toBe('')
  })

  it('says so for a disabled field too, and nothing for the first field', () => {
    document.body.innerHTML = '<input id="first"><input id="locked" disabled>'
    expect(() => fill([{ selector: '#first', value: 'Ada' }, { selector: '#locked', value: 'x' }]))
      .toThrow('Form field 2 is natively disabled; form write rejected. Form field 1 was already filled.')
    expect(() => fill([{ selector: '#none', value: 'x' }]))
      .toThrow(/^Form field 1 was not found\. Take a fresh browser_snapshot and use its ref, or provide a CSS selector\.$/)
  })

  it('says so for a field that is missing, has no such option or cannot be written', () => {
    document.body.innerHTML = '<input id="first"><input id="second"><select id="size"><option>S</option></select><div id="text">text</div>'
    const first = [{ selector: '#first', value: 'Ada' }, { selector: '#second', value: 'Lovelace' }]
    expect(() => fill([...first, { selector: '#missing', value: 'x' }]))
      .toThrow('Form field 3 was not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector. Form fields 1–2 were already filled.')
    expect(() => fill([...first, { selector: '#size', value: 'XL' }]))
      .toThrow('Select option not found for form field 3: XL. Form fields 1–2 were already filled.')
    expect(() => fill([...first, { selector: '#text', value: 'x' }]))
      .toThrow('Form field 3 is not editable. Form fields 1–2 were already filled.')
    expect((document.querySelector('#first') as HTMLInputElement).value).toBe('Ada')
  })

  it('reports what each field holds', () => {
    document.body.innerHTML = '<input id="name"><input id="qty" type="number">'
    expect(fill([{ selector: '#name', value: 'Ada' }, { selector: '#qty', value: '2' }])).toEqual([
      { index: 0, tag: 'input', value: 'Ada' },
      { index: 1, tag: 'input', value: '2' }
    ])
  })
})
