import { expect, test, text } from './capability-fixtures.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

for (const tag of ['input', 'select', 'textarea']) {
  test(`excludes customized ${tag} controls including absent/removed is attributes`, async ({ capabilities, electronApp }) => {
    const { client, tabId, fixtureUrl } = capabilities
    const shape = await electronApp.evaluate(async ({ webContents }, { url, tag }) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      return page.executeJavaScript(`(() => {
        const tag=${JSON.stringify(tag)};
        const Base={input:HTMLInputElement,select:HTMLSelectElement,textarea:HTMLTextAreaElement}[tag];
        globalThis.customCalls=0;globalThis.authorReads=0;globalThis.formEvents=0;
        class CustomControl extends Base {
          constructor(){super();customCalls++}
          connectedCallback(){customCalls++}
          get validity(){authorReads++;throw Error('Author validity getter')}
          get willValidate(){authorReads++;throw Error('Author willValidate getter')}
          get validationMessage(){authorReads++;throw Error('PRIVATE_CUSTOM_MESSAGE')}
          get value(){authorReads++;throw Error('PRIVATE_FIELD_VALUE')}
          attachInternals(){authorReads++;throw Error('Author attachInternals')}
        }
        customElements.define('validity-control',CustomControl,{extends:tag});
        document.body.innerHTML='<'+tag+' id="plain" required></'+tag+'><'+tag+' id="parser" is="validity-control" required></'+tag+'><'+tag+' id="removed" is="validity-control" required></'+tag+'>';
        document.getElementById('removed').removeAttribute('is');
        for(const [id,node] of [
          ['programmatic',document.createElement(tag,{is:'validity-control'})],
          ['constructed',new CustomControl()],
          ['unregistered',document.createElement(tag,{is:'undefined-control'})]
        ]){node.id=id;node.required=true;document.body.append(node)}
        HTMLElement.prototype.attachInternals=()=>{authorReads++;throw Error('Author prototype method')};
        for(const name of ['invalid','input','change','focus','submit'])document.addEventListener(name,()=>formEvents++,true);
        globalThis.customCallsBefore=customCalls;
        return ['plain','parser','removed','programmatic','constructed','unregistered'].map(id=>({id,is:document.getElementById(id).hasAttribute('is')}));
      })()`, false)
    }, { url: fixtureUrl, tag })
    expect(shape).toEqual(['plain', 'parser', 'removed', 'programmatic', 'constructed', 'unregistered'].map(id => ({ id, is: id === 'parser' })))
    for (const id of ['plain', 'parser', 'removed', 'programmatic', 'constructed', 'unregistered']) {
      const result = await client.callTool({ name: 'browser_element_inspect', arguments: { tabId, selector: `#${id}`, includeValidity: true } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      expect(text(result)).not.toMatch(/PRIVATE_FIELD_VALUE|PRIVATE_CUSTOM_MESSAGE/)
      const report = JSON.parse(text(result)).formValidity
      if (id === 'plain') expect(report).toMatchObject({ status: 'observed', willValidate: true })
      else expect(report).toEqual({ status: 'unavailable', reason: 'unsupported-target' })
    }
    expect(await electronApp.evaluate(async ({ webContents }, url) => {
      return webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('({callbacks:customCalls-customCallsBefore,reads:authorReads,events:formEvents})', false)
    }, fixtureUrl)).toEqual({ callbacks: 0, reads: 0, events: 0 })
  })
}

test('unknown native eligibility behavior fails closed', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await electronApp.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
    await page.executeJavaScript('document.body.innerHTML=\'<input id="target" required>\';void 0', false)
  }, fixtureUrl)
  for (const behavior of ['throw', 'return']) {
    await electronApp.evaluate(async ({ webContents }, { url, behavior }) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      await page.executeJavaScriptInIsolatedWorld(1006, [{ code: `
        globalThis.originalAttachInternals??=HTMLElement.prototype.attachInternals;
        HTMLElement.prototype.attachInternals=()=>{${behavior === 'throw' ? "throw new DOMException('Changed native refusal','NotSupportedError')" : 'return {}'}};
        void 0` }], false)
    }, { url: fixtureUrl, behavior })
    try {
      const result = await client.callTool({ name: 'browser_element_inspect', arguments: { tabId, selector: '#target', includeValidity: true } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      expect(JSON.parse(text(result)).formValidity).toEqual({ status: 'unavailable', reason: 'unsupported-target' })
    } finally {
      await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        await page.executeJavaScriptInIsolatedWorld(1006, [{ code: 'HTMLElement.prototype.attachInternals=globalThis.originalAttachInternals;void 0' }], false)
      }, fixtureUrl)
    }
  }
})
