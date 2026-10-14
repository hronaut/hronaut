import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test('compares one native text value with an expected string without returning either value', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const onPage = (code: string) => electronApp.evaluate(async ({ webContents }, { url, code }) => {
    return webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript(code, false)
  }, { url: fixtureUrl, code })
  const multiline = 'PRIVATE_LINE_ONE\nсекрет 𝌆 😀'
  await onPage(`document.body.innerHTML = '<input id="notes" value="PRIVATE_DEFAULT"><textarea id="area"></textarea><input id="empty"><input id="spaced"><input id="big"><input id="disabled" disabled value="PRIVATE_DISABLED"><input id="readonly" readonly value="PRIVATE_READONLY"><input id="password" type="password"><input id="email" type="email"><input id="otp" autocomplete="one-time-code"><input id="payment" autocomplete="cc-number"><input id="hidden" hidden><input id="hidden-type" type="hidden"><div id="editor" contenteditable>PRIVATE_EDITOR</div><input class="twin"><input class="twin">';
    notes.value='PRIVATE_CURRENT';area.value=${JSON.stringify(multiline)};spaced.value=' PRIVATE_SPACED ';big.value='x'.repeat(4097);
    password.value='PRIVATE_PASSWORD';email.value='PRIVATE_EMAIL';otp.value='PRIVATE_OTP';payment.value='PRIVATE_CARD';
    globalThis.nativeValueSetter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    globalThis.comparisonGetterCalls=0;globalThis.comparisonEvents=0;
    for(const name of ['input','change','focus','blur','select','invalid'])document.addEventListener(name,()=>comparisonEvents++,true);
    for(const prototype of [HTMLInputElement.prototype,HTMLTextAreaElement.prototype])
      Object.defineProperty(prototype,'value',{configurable:true,get(){comparisonGetterCalls++;return 'PRIVATE_SPOOF'},set(){}});
    void 0`)
  await electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
    const original = page.executeJavaScriptInIsolatedWorld
    const scope = globalThis as typeof globalThis & { __comparisonWitness?: { clean: boolean; restore(): void } }
    const witness = { clean: true, restore: () => { page.executeJavaScriptInIsolatedWorld = original } }
    scope.__comparisonWitness = witness
    page.executeJavaScriptInIsolatedWorld = async function (...args) {
      const raw = await original.apply(this, args)
      if (args[0] === 1006) witness.clean &&= !/PRIVATE_|секрет/.test(JSON.stringify(raw) ?? '')
      return raw
    }
  }, fixtureUrl)
  try {
    const inspect = (selector: string, expectedValue: unknown, extra: Record<string, unknown> = {}) => client.callTool({
      name: 'browser_element_inspect', arguments: { tabId, selector, expectedValue, ...extra }
    }) as Promise<CallToolResult>
    const compare = async (selector: string, expectedValue: string) => {
      const result = await inspect(selector, expectedValue)
      expect(result.isError, text(result)).not.toBe(true)
      expect(text(result)).not.toMatch(/PRIVATE_|секрет|𝌆/)
      return JSON.parse(text(result)).valueComparison
    }
    const match = { status: 'match' }, mismatch = { status: 'mismatch' }
    // The current native value, not the HTML default or a page-defined getter.
    expect(await compare('#notes', 'PRIVATE_CURRENT')).toEqual(match)
    expect(await compare('#notes', 'PRIVATE_DEFAULT')).toEqual(mismatch)
    expect(await compare('#notes', 'PRIVATE_SPOOF')).toEqual(mismatch)
    expect(await compare('#notes', 'private_current')).toEqual(mismatch)
    expect(await compare('#area', multiline)).toEqual(match)
    expect(await compare('#area', multiline.normalize('NFD') + ' ')).toEqual(mismatch)
    expect(await compare('#empty', '')).toEqual(match)
    expect(await compare('#empty', ' ')).toEqual(mismatch)
    expect(await compare('#spaced', ' PRIVATE_SPACED ')).toEqual(match)
    expect(await compare('#spaced', 'PRIVATE_SPACED')).toEqual(mismatch)
    expect(await compare('#disabled', 'PRIVATE_DISABLED')).toEqual(match)
    expect(await compare('#readonly', 'PRIVATE_READONLY')).toEqual(match)
    expect(await compare('#big', 'x'.repeat(4096))).toEqual({ status: 'unavailable', reason: 'oversized' })
    for (const selector of ['#password', '#email', '#otp', '#payment', '#hidden', '#hidden-type', '#editor']) {
      expect(await compare(selector, `PRIVATE_${selector.slice(1).toUpperCase()}`)).toEqual({ status: 'unavailable', reason: 'unsupported-target' })
    }
    // An application rewrite is observed as a mismatch without another write.
    await onPage("nativeValueSetter.call(document.querySelector('#notes'),'PRIVATE_REWRITTEN');void 0")
    expect(await compare('#notes', 'PRIVATE_CURRENT')).toEqual(mismatch)
    expect(await compare('#notes', 'PRIVATE_REWRITTEN')).toEqual(match)

    for (const [selector, expected, extra] of [
      ['#notes', 'x'.repeat(4097), {}], ['#notes', 1, {}], ['#notes', 'PRIVATE_CURRENT', { ref: 'e1' }],
      ['#notes', 'PRIVATE_CURRENT', { includeValidity: true }], ['#notes', 'PRIVATE_CURRENT', { includePasswordOccupancy: true }],
      ['#notes', 'PRIVATE_CURRENT', { includeSizingInputs: true }], ['#notes', 'PRIVATE_CURRENT', { cssProperties: ['display'] }],
      ['#notes', 'PRIVATE_CURRENT', { includeFonts: true }], ['.twin', '', {}], ['#missing', '', {}]
    ] as Array<[string, unknown, Record<string, unknown>]>) {
      const rejected = await inspect(selector, expected, extra)
      expect(rejected.isError, `${selector} ${JSON.stringify(extra)}`).toBe(true)
      expect(text(rejected)).not.toMatch(/PRIVATE_/)
    }
    expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { __comparisonWitness?: { clean: boolean } }).__comparisonWitness?.clean)).toBe(true)
    expect(await onPage('({getters:comparisonGetterCalls,events:comparisonEvents,focus:document.activeElement===document.body,x:scrollX,y:scrollY,notes:document.querySelector("#notes").getAttribute("value")})'))
      .toEqual({ getters: 0, events: 0, focus: true, x: 0, y: 0, notes: 'PRIVATE_DEFAULT' })
  } finally {
    await electronApp.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __comparisonWitness?: { restore(): void } }
      scope.__comparisonWitness?.restore()
      delete scope.__comparisonWitness
    })
  }
})
