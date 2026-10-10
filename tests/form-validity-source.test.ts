import { randomUUID } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { formValiditySettlementScript, formValiditySource } from '../src/main/browser/form-validity.js'

describe('internal form-validity token contract', () => {
  it.each(['', 'token', "');globalThis.injected=true;//", '";alert(1)//', '</script>',
    '00000000-0000-4000-8000-000000000000\n', '00000000-0000-0000-8000-000000000000',
    '00000000-0000-4000-7000-000000000000', '\u2028', null, {}, 123])('rejects invalid tokens before constructing executable source: %s', token => {
    expect(() => formValiditySource(token as string)).toThrow('Invalid form validity inspection token')
    expect(() => formValiditySettlementScript(token as string)).toThrow('Invalid form validity inspection token')
    expect(() => formValiditySettlementScript(token as string, true)).toThrow('Invalid form validity inspection token')
  })

  it('addresses only the exact internal UUID handle for settlement and cleanup', () => {
    const token = randomUUID()
    let settled = 0, cleaned = 0
    const context = { __hronautFormValidity: new Map([[token, {
      settle: () => { settled++; return true }, cleanup: () => { cleaned++ }
    }]]) }
    expect(formValiditySource(token)).toContain(`const token='${token}'`)
    expect(runInNewContext(formValiditySettlementScript(token), context)).toBe(true)
    expect(runInNewContext(formValiditySettlementScript(randomUUID()), context)).toBe(false)
    expect(runInNewContext(formValiditySettlementScript(token, true), context)).toBe(false)
    expect({ settled, cleaned }).toEqual({ settled: 1, cleaned: 1 })
  })
})
