import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { pageFunctionExpression, pageScript } from '../src/shared/page-script.js'

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

  it('creates the page function and its helpers in strict code, so a built-in the page replaced cannot reach their arguments', () => {
    function joinValueInPage(secret: { value: string }): string { return [secret.value].join('') }
    function joinInPage(secret: { value: string }, joinValue: (secret: { value: string }) => string): string { return [secret.value].join('') + joinValue(secret) }
    // A page replaces Array.prototype.join and looks through `caller` for the arguments of whoever called it.
    const page = `var seen = [];
      Array.prototype.join = function join() {
        try { seen.push(String(join.caller && join.caller.arguments[0].value)) } catch { seen.push('refused') }
        return ''
      };`
    const run = (script: string): unknown => runInNewContext(`${page}\n${script};\nseen`, {})
    // Sloppy code, as the script would be without the strict expressions, shows the page the secret.
    expect(run(`(${joinInPage.toString()})({ value: 'secret' }, (${joinValueInPage.toString()}))`)).toEqual(['secret', 'secret'])
    expect(run(pageScript(joinInPage, { value: 'secret' }, joinValueInPage))).toEqual(['null', 'null'])
  })

  it('refuses a method or a bound function, which have no source a page can call', () => {
    const helpers = { read(value: string) { return value } }
    expect(() => pageScript(helpers.read, 'value')).toThrow('read cannot run in a page')
    expect(() => pageScript(describeInPage.bind(null), { max: 1 }, 'label', (value: string) => value)).toThrow('bound describeInPage cannot run in a page')
  })

  it('gives an API that calls the function itself, such as the debugger, the same strict function and the same refusals', () => {
    function countInPage(this: { items: number[] }, max: number): number { return Math.min(this.items.length, max) }
    const expression = pageFunctionExpression(countInPage)
    expect(expression).toBe(`(() => { 'use strict'; return ${countInPage.toString()} })()`)
    expect(runInNewContext(`(${expression}).call({ items: [1, 2, 3] }, 2)`, {})).toBe(2)
    // Strict code gets no global object for a missing `this`, as sloppy code would.
    expect(() => runInNewContext(`(${expression}).call(undefined, 2)`, { items: [1] })).toThrow(/items/)
    expect(() => pageFunctionExpression({ read() { return 1 } }.read)).toThrow('read cannot run in a page')
  })
})
