import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { installFixedDate } from '../src/preload/fixed-date-bootstrap.js'

const EPOCH = Date.UTC(2026, 11, 31, 23, 59, 30, 250)

/** A fresh JavaScript realm, with the fixed Date installed the way the preload serializes it into the page. */
function realm(fixed: boolean): (code: string) => unknown {
  const context = createContext({})
  if (fixed) runInContext(`(${installFixedDate.toString()})(${EPOCH})`, context)
  return code => runInContext(code, context)
}

describe('fixed Date', () => {
  const page = realm(true)
  const native = realm(false)

  it('returns the instant from every current-time read', () => {
    expect(page('Date.now()')).toBe(EPOCH)
    expect(page('new Date().getTime()')).toBe(EPOCH)
    expect(page('new Date().toISOString()')).toBe('2026-12-31T23:59:30.250Z')
    expect(page('JSON.stringify({ at: new Date() })')).toBe('{"at":"2026-12-31T23:59:30.250Z"}')
    // Called without new, Date ignores its arguments, as the native one does.
    expect(page('Date()')).toBe(native(`new Date(${EPOCH}).toString()`))
    expect(page('Date(2001, 1, 2)')).toBe(native(`new Date(${EPOCH}).toString()`))
  })

  it('keeps explicit dates, parsing and UTC conversion native', () => {
    for (const expression of [
      'new Date(2020, 0, 2, 3, 4, 5, 6).getTime()',
      'new Date("2020-01-02T03:04:05Z").getTime()',
      'new Date("March 7, 2021").getTime()',
      'new Date(0).getTime()',
      'new Date(new Date(5)).getTime()',
      'Date.parse("2024-02-29T12:00:00+02:00")',
      'Date.parse("not a date")',
      'Date.UTC(2024, 1, 29, 12)',
      'Date.UTC(275760, 8, 13, 0, 0, 0, 1)',
      'String(new Date(undefined).getTime())',
      'String(new Date(NaN).getTime())',
      'String(new Date(8.64e15 + 1).getTime())',
      'new Date(8.64e15).toISOString()',
      'new Date(-8.64e15).toISOString()',
      'new Date(2020, 0).getTimezoneOffset()'
    ]) expect(page(expression), expression).toEqual(native(expression))
    expect(page('(() => { try { new Date(NaN).toISOString() } catch (error) { return error.name } })()')).toBe('RangeError')
  })

  it('keeps the shape of the native Date', () => {
    for (const expression of [
      'typeof Date',
      'Date.length',
      'Date.name',
      'Date.now.name',
      'Date.now.length',
      '"prototype" in Date.now',
      'Object.getPrototypeOf(Date) === Function.prototype',
      'Date.prototype.constructor === Date',
      'Object.getPrototypeOf(new Date()) === Date.prototype',
      'new Date() instanceof Date',
      'Object.prototype.toString.call(new Date())',
      'JSON.stringify(Object.getOwnPropertyDescriptor(globalThis, "Date"), ["writable", "enumerable", "configurable"])',
      'JSON.stringify(Object.getOwnPropertyDescriptor(Date, "prototype"), ["writable", "enumerable", "configurable"])',
      'JSON.stringify(Object.getOwnPropertyDescriptor(Date, "now"), ["writable", "enumerable", "configurable"])',
      'Object.keys(Date).length'
    ]) expect(page(expression), expression).toEqual(native(expression))
    expect(page('(() => { try { new Date.now() } catch (error) { return error.name } })()')).toBe('TypeError')
  })

  it('lets subclasses and Reflect.construct use the instant or their own arguments', () => {
    page('class Deadline extends Date { label() { return "deadline" } }; globalThis.Deadline = Deadline')
    expect(page('new Deadline().getTime()')).toBe(EPOCH)
    expect(page('new Deadline(5).getTime()')).toBe(5)
    expect(page('new Deadline() instanceof Deadline && new Deadline() instanceof Date')).toBe(true)
    expect(page('new Deadline().label()')).toBe('deadline')
    expect(page('Reflect.construct(Date, [], Deadline) instanceof Deadline')).toBe(true)
    expect(page('Reflect.construct(Date, []).getTime()')).toBe(EPOCH)
  })

  it('is not changed by page code that replaces Date methods afterward', () => {
    const later = realm(true)
    later('Date.prototype.toString = () => "page"')
    expect(later('Date()')).toBe(native(`new Date(${EPOCH}).toString()`))
    later('Date.now = () => 1')
    expect(later('new Date().getTime()')).toBe(EPOCH)
  })
})
