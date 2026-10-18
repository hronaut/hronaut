import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { test, expect, text } from './capability-fixtures.js'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test('reports the immediate flex container of an element, or why there is none, without reading anything else', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const page = (code: string) => electronApp.evaluate(async ({ webContents }, { url, code }) => {
    return webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript(code, false)
  }, { url: fixtureUrl, code })
  await page(`document.body.innerHTML='<div style="height:2000px"></div><div id="container" data-secret="PRIVATE_PARENT"><div id="target"></div><div id="sibling" data-secret="PRIVATE_SIBLING">PRIVATE_SIBLING_TEXT</div></div><input id="field" value="PRIVATE_VALUE"><x-bar id="custom"><div id="customtarget"></div></x-bar><div id="openhost"><div id="slotted"></div></div>';
    container.style.cssText='display:flex;width:300px;height:100px;padding:5px 10px 3px 20px;border:4px solid;column-gap:10px;--private:PRIVATE_CSS';
    target.style.cssText='flex:1 1 0;min-width:0';sibling.style.cssText='flex:0 0 50px;min-width:0;overflow:hidden';
    custom.style.display='flex';openhost.style.display='flex';openhost.attachShadow({mode:'open'}).innerHTML='<slot></slot>';
    field.focus();scrollTo(0, 40);
    window.getterCalls=0;window.getComputedStyle=()=>{getterCalls++;throw Error('Main-world getter called')};
    CSSStyleDeclaration.prototype.getPropertyValue=()=>{getterCalls++;throw Error('Main-world CSS getter called')};void 0`)
  const before = await page('[scrollX, scrollY, document.activeElement.id]') as unknown[]
  expect(before[2]).toBe('field')
  const inspect = (selector: string, extra: Record<string, unknown> = {}) =>
    client.callTool({ name: 'browser_element_inspect', arguments: { tabId, selector, includeFlexContainer: true, ...extra } }) as Promise<CallToolResult>
  const report = async (selector = '#target') => {
    const result = await inspect(selector)
    expect(result.isError, text(result)).not.toBe(true)
    expect(text(result)).not.toMatch(/PRIVATE_/)
    return JSON.parse(text(result))
  }

  const row = await report()
  expect(row.flexContainer).toEqual({
    status: 'observed', display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', rowGap: 'normal', columnGap: '10px',
    direction: 'ltr', writingMode: 'horizontal-tb', contentWidth: 300, contentHeight: 100
  })
  expect(row.sizingInputs).toMatchObject({ 'flex-grow': 1, 'flex-shrink': 1, 'min-width': '0px' })
  expect(row.box.width).toBe(240)
  expect(JSON.parse(text(await inspect('#target', { includeFlexContainer: false })))).not.toHaveProperty('flexContainer')

  await page(`container.style.cssText='display:inline-flex;flex-flow:column-reverse wrap;gap:4px 12.5%;direction:rtl;writing-mode:vertical-rl;width:200px;height:80px;overflow:scroll';void 0`)
  const column = await report()
  expect(column.flexContainer).toMatchObject({ status: 'observed', display: 'inline-flex', flexDirection: 'column-reverse', flexWrap: 'wrap', rowGap: '4px', columnGap: '12.5%', direction: 'rtl', writingMode: 'vertical-rl' })
  // The client size, which leaves scrollbars out, minus no padding.
  expect([column.flexContainer.contentWidth, column.flexContainer.contentHeight]).toEqual(await page('[container.clientWidth, container.clientHeight]'))

  await page(`container.style.cssText='display:flex';target.style.cssText='position:absolute';void 0`)
  expect((await report()).flexContainer).toEqual({ status: 'unavailable', reason: 'item-out-of-flow' })
  await page(`target.style.cssText='display:contents';void 0`)
  expect((await report()).flexContainer).toEqual({ status: 'unavailable', reason: 'item-display-contents' })
  await page(`target.style.cssText='';container.style.cssText='display:block';void 0`)
  expect((await report()).flexContainer).toEqual({ status: 'unavailable', reason: 'not-flex-container' })
  expect((await report('#customtarget')).flexContainer).toEqual({ status: 'unavailable', reason: 'shadow-host-or-custom-element' })
  expect((await report('#slotted')).flexContainer).toEqual({ status: 'unavailable', reason: 'shadow-host-or-custom-element' })
  // A flex button lays its children out in an anonymous inner box, and a hidden grandparent leaves no box at all.
  await page(`container.style.cssText='display:flex';container.insertAdjacentHTML('beforeend','<button id="button" style="display:flex;height:60px"><span id="icon">i</span></button><div id="hidden" style="display:none"><div style="display:flex"><div id="hiddentarget"></div></div></div>');void 0`)
  expect((await report('#icon')).flexContainer).toEqual({ status: 'unavailable', reason: 'native-or-anonymous-container' })
  expect((await report('#hiddentarget')).flexContainer).toEqual({ status: 'unavailable', reason: 'item-not-rendered' })

  for (const extra of [{ ref: 'anything' }, { includeFlexContainer: 'true' }, { includeValidity: true }, { includeFonts: true }]) {
    expect((await inspect('#target', extra)).isError, JSON.stringify(extra)).toBe(true)
  }
  expect((await inspect('div')).isError).toBe(true)
  // Nothing ran in the page's own world, and the scroll position and focus are where the page left them.
  expect(await page('[getterCalls, scrollX, scrollY, document.activeElement.id]')).toEqual([0, ...before])
})
