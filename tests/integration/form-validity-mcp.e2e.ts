import type { BrowserState, HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test('inspects native form validity without values, validation UI or page getters', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const onPage = (code: string) => electronApp.evaluate(async ({ webContents }, { url, code }) => {
    return webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript(code, false)
  }, { url: fixtureUrl, code })
  await onPage(`document.body.innerHTML = '<input id="required" required><input id="email" type="email"><input id="number" type="number" min="10" max="20" step="3"><input id="optional"><input id="disabled" required disabled><input id="readonly" required readonly><textarea id="custom"></textarea><select id="select" required><option value="">Choose</option></select><input id="password" type="password"><input id="otp" autocomplete="one-time-code"><input id="payment" autocomplete="section-payment cc-number"><input id="file" type="file"><input id="hidden" hidden><input id="hidden-type" type="hidden"><div id="editor" contenteditable></div>';
    email.value='PRIVATE_FORM_VALUE';number.value='11';custom.setCustomValidity('PRIVATE_CUSTOM_ERROR');
    globalThis.validityGetterCalls=0;globalThis.validityEvents=0;
    for(const name of ['invalid','input','change','focus','submit'])document.addEventListener(name,()=>validityEvents++,true);
    for(const prototype of [HTMLInputElement.prototype,HTMLTextAreaElement.prototype,HTMLSelectElement.prototype]){
      for(const name of ['validity','willValidate','validationMessage'])Object.defineProperty(prototype,name,{get(){validityGetterCalls++;throw Error('Page getter called')}});
      for(const name of ['checkValidity','reportValidity','setCustomValidity'])prototype[name]=()=>{validityGetterCalls++;throw Error('Page method called')};
    }
    for(const name of Object.getOwnPropertyNames(ValidityState.prototype).filter(name=>name!=='constructor'))Object.defineProperty(ValidityState.prototype,name,{get(){validityGetterCalls++;throw Error('Page validity getter called')}});
    Object.defineProperty(required,'validity',{get(){validityGetterCalls++;throw Error('Own getter called')}});
    void 0`)
  await electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
    const original = page.executeJavaScriptInIsolatedWorld
    const scope = globalThis as typeof globalThis & { __validityWitness?: { clean: boolean; restore(): void } }
    const witness = { clean: true, restore: () => { page.executeJavaScriptInIsolatedWorld = original } }
    scope.__validityWitness = witness
    page.executeJavaScriptInIsolatedWorld = async function (...args) {
      const raw = await original.apply(this, args)
      if (args[0] === 1006) witness.clean &&= !/PRIVATE_FORM_VALUE|PRIVATE_CUSTOM_ERROR/.test(JSON.stringify(raw) ?? '')
      return raw
    }
  }, fixtureUrl)
  try {
    const inspect = async (selector: string, extra: Record<string, unknown> = {}) => client.callTool({
      name: 'browser_element_inspect', arguments: { tabId, selector, includeValidity: true, ...extra }
    }) as Promise<CallToolResult>
    const native = async (selector: string) => {
      const result = await inspect(selector)
      expect(result.isError, text(result)).not.toBe(true)
      expect(text(result)).not.toMatch(/PRIVATE_FORM_VALUE|PRIVATE_CUSTOM_ERROR/)
      return JSON.parse(text(result)).formValidity
    }
    expect(JSON.parse(text(await inspect('#required', { includeValidity: undefined })))).not.toHaveProperty('formValidity')
    expect(JSON.parse(text(await inspect('#required', { includeValidity: false })))).not.toHaveProperty('formValidity')
    expect(await native('#required')).toMatchObject({ status: 'observed', willValidate: true, validity: { valueMissing: true, valid: false } })
    expect(await native('#email')).toMatchObject({ status: 'observed', validity: { typeMismatch: true, valid: false } })
    expect(await native('#number')).toMatchObject({ status: 'observed', validity: { stepMismatch: true, valid: false } })
    await onPage("number.value='9';void 0")
    expect(await native('#number')).toMatchObject({ status: 'observed', validity: { rangeUnderflow: true } })
    await onPage("number.value='21';void 0")
    expect(await native('#number')).toMatchObject({ status: 'observed', validity: { rangeOverflow: true } })
    expect(await native('#custom')).toMatchObject({ status: 'observed', validity: { customError: true, valid: false } })
    expect(await native('#select')).toMatchObject({ status: 'observed', willValidate: true, validity: { valueMissing: true } })
    expect(await native('#optional')).toMatchObject({ status: 'observed', willValidate: true, validity: { valid: true } })
    for (const selector of ['#disabled', '#readonly']) expect(await native(selector)).toMatchObject({ status: 'observed', willValidate: false })
    for (const selector of ['#password', '#otp', '#payment', '#file', '#hidden', '#hidden-type', '#editor']) {
      expect(await native(selector)).toEqual({ status: 'unavailable', reason: 'unsupported-target' })
    }
    for (const extra of [{ includeValidity: 'true' }, { ref: 'irrelevant' }, { includePasswordOccupancy: true }, { cssProperties: ['display'] }, { includeFonts: true }]) {
      expect((await inspect('#required', extra)).isError).toBe(true)
    }
    expect((await inspect('input')).isError).toBe(true)
    expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { __validityWitness?: { clean: boolean } }).__validityWitness?.clean)).toBe(true)
    expect(await onPage('({getters:validityGetterCalls,events:validityEvents,focus:document.activeElement===document.body,x:scrollX,y:scrollY})')).toEqual({ getters: 0, events: 0, focus: true, x: 0, y: 0 })
  } finally {
    await electronApp.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __validityWitness?: { restore(): void } }
      scope.__validityWitness?.restore()
      delete scope.__validityWitness
    })
  }
})

test('form validity does not follow-select, thaw or wake a background tab', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl, fixtureOrigin } = capabilities
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  await electronApp.evaluate(async ({ webContents }, url) => {
    await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('document.body.innerHTML=\'<input id="target" required>\';void 0')
  }, fixtureUrl)
  const other = JSON.parse(text(await call('browser_new_tab', { url: 'about:blank', active: true }))) as BrowserState
  await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setFollowAgentActivity(true))
  const inspect = () => call('browser_element_inspect', { tabId, selector: '#target', includeValidity: true })
  expect(JSON.parse(text(await inspect())).formValidity).toMatchObject({ status: 'observed', willValidate: true })
  expect((JSON.parse(text(await call('browser_status', {}))) as BrowserState).activeTabId).toBe(other.activeTabId)
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabPageLifecycle(id, 'frozen'), tabId)
  expect((await inspect()).isError).toBe(true)
  expect((JSON.parse(text(await call('browser_status', {}))) as BrowserState).tabs.find(tab => tab.id === tabId)?.pageLifecycleState).toBe('frozen')
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabPageLifecycle(id, 'active'), tabId)
  await electronApp.evaluate(async ({ webContents }, { url, destination }) => {
    await webContents.getAllWebContents().find(page => page.getURL() === url)!.loadURL(destination)
  }, { url: fixtureUrl, destination: `${fixtureOrigin}/route-target` })
  // Establish the sleep precondition after direct fixture navigation.
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), other.activeTabId!)
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(id, true), tabId)
  expect((await inspect()).isError).toBe(true)
  const state = JSON.parse(text(await call('browser_status', {}))) as BrowserState
  expect(state.tabs.find(tab => tab.id === tabId)?.sleeping).toBe(true)
  expect(state.activeTabId).toBe(other.activeTabId)
})
