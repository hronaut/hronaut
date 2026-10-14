import type { BrowserState, HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { test, expect, text } from './capability-fixtures.js'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test('computed sizing inputs remain item-only across flex, block and closed shadow layout', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const onPage = (code: string) => electronApp.evaluate(async ({ webContents }, { url, code }) => {
    return webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript(code, false)
  }, { url: fixtureUrl, code })
  await onPage(`document.body.innerHTML='<div id="parent" data-secret="PRIVATE_PARENT"><div id="target"></div><div id="sibling" data-secret="PRIVATE_SIBLING">PRIVATE_SIBLING_TEXT</div></div><input id="password" type="password" value="PRIVATE_VALUE"><iframe id="frame"></iframe><div id="openhost"></div>';
    parentNode=document.querySelector('#parent');parentNode.style.cssText='display:flex;width:300px';target.style.cssText='flex:1 1 50%;min-width:0;min-height:0;height:20px;--private:PRIVATE_CSS';sibling.style.cssText='flex:0 0 100px;min-width:0';
    openhost.attachShadow({mode:'open'}).innerHTML='<div id="shadowtarget"></div>';
    frame.contentDocument.body.innerHTML='<div id="frametarget"></div>';
    window.getterCalls=0;window.getComputedStyle=()=>{getterCalls++;throw Error('Main-world getter called')};
    CSSStyleDeclaration.prototype.getPropertyValue=()=>{getterCalls++;throw Error('Main-world CSS getter called')};void 0`)
  const inspect = async (selector = '#target', extra: Record<string, unknown> = {}) => client.callTool({ name: 'browser_element_inspect', arguments: { tabId, selector, includeSizingInputs: true, ...extra } }) as Promise<CallToolResult>
  const report = async () => {
    const result = await inspect()
    expect(result.isError, text(result)).not.toBe(true)
    expect(text(result)).not.toMatch(/PRIVATE_PARENT|PRIVATE_SIBLING|PRIVATE_VALUE|PRIVATE_CSS/)
    return JSON.parse(text(result))
  }
  expect(JSON.parse(text(await inspect('#target', { includeSizingInputs: false })))).not.toHaveProperty('sizingInputs')
  const ordinary = await report()
  expect(ordinary.sizingInputs).toEqual({ 'flex-basis': '50%', 'flex-grow': 1, 'flex-shrink': 1, 'min-width': '0px', 'max-width': 'none', 'min-height': '0px', 'max-height': 'none', 'align-self': 'auto' })
  expect(ordinary.box.width).toBe(200)
  // An intervening closed-root block changes rendered parentage without changing
  // the selected element's computed inputs or measured box. Never infer flex participation.
  await onPage(`window.closedRoot=parentNode.attachShadow({mode:'closed'});closedRoot.innerHTML='<div style="display:block;width:200px"><slot></slot></div>';void 0`)
  const shadow = await report()
  expect(shadow.sizingInputs).toEqual(ordinary.sizingInputs)
  expect(shadow.box.width).toBe(ordinary.box.width)
  await onPage(`closedRoot.firstChild.style.cssText='display:block;width:90px;transform:scale(2);transform-origin:0 0';void 0`)
  const transformed = await report()
  expect(transformed.sizingInputs).toEqual(ordinary.sizingInputs)
  expect(transformed.box.width).toBe(180)
  await onPage(`target.style.cssText='flex:2 0 auto;min-width:auto;max-width:80px;min-height:12px;max-height:30px;align-self:flex-end';void 0`)
  expect((await report()).sizingInputs).toEqual({ 'flex-basis': 'auto', 'flex-grow': 2, 'flex-shrink': 0, 'min-width': '0px', 'max-width': '80px', 'min-height': '12px', 'max-height': '30px', 'align-self': 'flex-end' })
  await onPage(`target.style.flexBasis='calc(50% + 2px)';void 0`)
  expect((await report()).sizingInputs['flex-basis']).toBeNull()
  for (const selector of ['#shadowtarget', '#frametarget', 'div', '#missing']) expect((await inspect(selector)).isError).toBe(true)
  for (const extra of [{ ref: 'anything' }, { includeSizingInputs: 'true' }, { includeValidity: true }, { includePasswordOccupancy: true }, { includeFonts: true }, { cssProperties: ['display'] }]) expect((await inspect('#target', extra)).isError).toBe(true)
  const password = await inspect('#password')
  expect(password.isError, text(password)).not.toBe(true)
  expect(text(password)).not.toContain('PRIVATE_VALUE')
  expect(await onPage('getterCalls')).toBe(0)
})

test('sizing inputs retain auto and percentage semantics across row, column and writing modes', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const page = (code: string) => electronApp.evaluate(async ({ webContents }, { url, code }) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(code), { url: fixtureUrl, code })
  await page(`document.body.innerHTML='<div id="container"><div id="target">XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX</div><div style="flex:0 0 100px"></div></div>';container.style.cssText='display:flex;width:240px;height:200px';target.style.cssText='flex:1 1 50%;min-width:auto';void 0`)
  const inspect = async () => {
    const result = await client.callTool({ name: 'browser_element_inspect', arguments: { tabId, selector: '#target', includeSizingInputs: true } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  const automatic = await inspect()
  expect(automatic.sizingInputs['min-width']).toBe('auto')
  await page("target.style.minWidth='0';void 0")
  const zero = await inspect()
  expect(zero.sizingInputs['min-width']).toBe('0px')
  expect(zero.box.width).toBeLessThan(automatic.box.width)
  for (const style of ['flex-direction:column', 'flex-direction:row;writing-mode:vertical-rl;direction:rtl']) {
    await page(`container.style.cssText='display:flex;width:240px;height:200px;${style}';void 0`)
    expect((await inspect()).sizingInputs).toEqual(zero.sizingInputs)
  }
  await page("target.style.cssText='flex:3 2 auto;min-width:12px;max-width:80px;min-height:10px;max-height:60px;align-self:stretch';void 0")
  expect((await inspect()).sizingInputs).toEqual({ 'flex-basis': 'auto', 'flex-grow': 3, 'flex-shrink': 2, 'min-width': '12px', 'max-width': '80px', 'min-height': '10px', 'max-height': '60px', 'align-self': 'stretch' })
})

test('sizing inputs do not follow-select, thaw or wake a background tab', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl, fixtureOrigin } = capabilities
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  await electronApp.evaluate(async ({ webContents }, url) => {
    await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('document.body.innerHTML=\'<input id="target" required>\';void 0')
  }, fixtureUrl)
  const other = JSON.parse(text(await call('browser_new_tab', { url: 'about:blank', active: true }))) as BrowserState
  await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setFollowAgentActivity(true))
  const inspect = () => call('browser_element_inspect', { tabId, selector: '#target', includeSizingInputs: true })
  expect(JSON.parse(text(await inspect())).sizingInputs).toMatchObject({ 'flex-grow': 0 })
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


test('sizing preflight bounds documents and preserves selected-element scroll opt-in', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const page = (code: string) => electronApp.evaluate(async ({ webContents }, { url, code }) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(code), { url: fixtureUrl, code })
  await page("document.body.innerHTML='<div id=target style=width:80px;height:30px;overflow:auto><div style=height:200px></div></div>';void 0")
  const inspect = () => client.callTool({ name: 'browser_element_inspect', arguments: { tabId, selector: '#target', includeSizingInputs: true, includeScroll: true } }) as Promise<CallToolResult>
  const initial = await inspect()
  expect(initial.isError, text(initial)).not.toBe(true)
  expect(JSON.parse(text(initial)).sizingInputs['flex-basis']).toBe('auto')
  expect(JSON.parse(text(initial)).scrollGeometry).toMatchObject({ status: 'observed', clientHeight: 30, scrollHeight: 200 })
  await page("document.body.insertAdjacentHTML('beforeend','<i></i>'.repeat(5001));void 0")
  const bounded = await inspect()
  expect(bounded.isError).toBe(true)
  expect(text(bounded)).not.toContain('sizingInputs')
})
