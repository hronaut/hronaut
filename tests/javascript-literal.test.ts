import { describe, expect, it } from 'vitest'
import { javascriptLiteral } from '../src/shared/javascript-literal.js'

describe('javascriptLiteral', () => {
  it('round-trips executable-source delimiters without leaving raw parser boundaries', () => {
    const value = {
      text: '</script>";globalThis.pwned = true;//\u2028next\u2029line',
      coordinates: { x: 12, y: -4 }
    }
    const literal = javascriptLiteral(value)

    expect(literal).not.toMatch(/[<>\u2028\u2029]/u)
    expect(Function(`return ${literal}`)()).toEqual(value)
  })

  it('rejects values that JSON cannot represent', () => {
    expect(() => javascriptLiteral(undefined)).toThrow('cannot be represented')
  })
})
