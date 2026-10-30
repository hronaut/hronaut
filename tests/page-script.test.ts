import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { pageScript } from '../src/shared/page-script.js'

function describeInPage(limits: { max: number }, label: string | undefined, format: (value: string) => string): string {
  return format(`${label ?? 'none'}:${limits.max}`)
}

describe('page scripts', () => {
  it('calls the page function with its values as literals and its helpers as their own source', () => {
    const script = pageScript(describeInPage, { max: 3 }, undefined, (value: string) => value.toUpperCase())
    expect(runInNewContext(script, {})).toBe('NONE:3')
    // A value never closes the script tag or the line it is written into.
    expect(pageScript((text: string) => text, '</script>\u2028')).not.toMatch(/<\/script>|\u2028/u)
  })

  it('refuses a method or a bound function, which have no source a page can call', () => {
    const helpers = { read(value: string) { return value } }
    expect(() => pageScript(helpers.read, 'value')).toThrow('read cannot run in a page')
    expect(() => pageScript(describeInPage.bind(null), { max: 1 }, 'label', (value: string) => value)).toThrow('bound describeInPage cannot run in a page')
  })
})
