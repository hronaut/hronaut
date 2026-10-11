import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

type GetterTrap = { kind: string; realm: string; at: number }
function assertNoGetterEffects(before: GetterTrap[], after: GetterTrap[]): void {
  expect(after).toEqual(before)
}

// Trace iframe annotation creates a main-world ElementHandle preview that
// independently reads poisoned getters. Keep trace events/screenshots/sources;
// isolate this getter test from the snapshotter instead of filtering later reads.
test.use({ trace: { mode: 'retain-on-failure', snapshots: false, screenshots: true, sources: true } })

test('frame observation preserves ownership and isolation for poisoned getters', async ({ capabilities, electronApp }, testInfo) => {
  const server = createServer((q, r) => {
    r.setHeader('Content-Type', 'text/html')
    r.end(q.url?.startsWith('/parent') ? '<h1>Parent sentinel</h1><iframe id="chosen" src="/child"></iframe>' : '<h1>Isolated child sentinel</h1>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const read = () => capabilities.client.callTool({ name: 'browser_snapshot', arguments: { tabId: capabilities.tabId, frameSelector: '#chosen' } }) as Promise<CallToolResult>
  try {
    await capabilities.client.callTool({ name: 'browser_navigate', arguments: { tabId: capabilities.tabId, url: origin + '/parent' } })
    const beforeTraps = await electronApp.evaluate(async ({ webContents }, origin) => webContents.getAllWebContents().find(p => p.getURL() === origin + '/parent')!.executeJavaScript(`(() => {
      window.traps=[];window.trapOverflow=0;
      const record=(realm,kind)=>{if(window.traps.length<128)window.traps.push({realm,kind,at:Date.now()});else window.trapOverflow++};
      const f=document.querySelector('#chosen'),child=f.contentWindow;
      for(const [label,realm] of [['parent',window],['child',child]]) {
        Object.defineProperty(realm.Node.prototype,'textContent',{get(){record(label,'textContent');throw Error('trap')}});
        Object.defineProperty(realm.HTMLElement.prototype,'innerText',{get(){record(label,'innerText');throw Error('trap')}});
      }
      Object.defineProperty(f,'contentDocument',{get(){record('parent','contentDocument');return document}});
      // Exercise every installed poison synchronously; no incidental preview
      // or later MCP getter can supply this fixture's positive control.
      for(const realm of [window,child]) for(const key of ['textContent','innerText']) {
        let threw=false;try{void realm.document.body[key]}catch(error){if(error.message!=='trap')throw error;threw=true}
        if(!threw)throw Error('Expected poisoned getter to throw');
      }
      if(f.contentDocument!==document)throw Error('Expected poisoned frame getter');
      return window.traps;
    })()`, false), origin) as GetterTrap[]
    expect(beforeTraps.map(({ realm, kind }) => ({ realm, kind }))).toEqual([
      { realm: 'parent', kind: 'textContent' }, { realm: 'parent', kind: 'innerText' },
      { realm: 'child', kind: 'textContent' }, { realm: 'child', kind: 'innerText' },
      { realm: 'parent', kind: 'contentDocument' }
    ])
    const result=await read();expect(result.isError,text(result)).not.toBe(true);expect(text(result)).toContain('Isolated child sentinel');expect(text(result)).not.toContain('Parent sentinel')
    const afterTraps=await electronApp.evaluate(async({webContents},origin)=>webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!.executeJavaScript('window.traps',false),origin) as GetterTrap[]
    await testInfo.attach('frame-getter-observation', { body: JSON.stringify({ beforeTraps, afterTraps }), contentType: 'application/json' })
    assertNoGetterEffects(beforeTraps, afterTraps)
    // A genuine later getter must still fail the identical observation oracle.
    // Keep all control and MCP evidence; never reset or filter the history.
    const sensitivity = await electronApp.evaluate(async ({ webContents }, origin) => webContents.getAllWebContents().find(p => p.getURL() === origin + '/parent')!.executeJavaScript(`(() => {
      try{void document.body.textContent}catch(error){if(error.message!=='trap')throw error}
      return {traps:window.traps,overflow:window.trapOverflow};
    })()`, false), origin) as { traps: GetterTrap[]; overflow: number }
    await testInfo.attach('frame-getter-sensitivity', { body: JSON.stringify(sensitivity), contentType: 'application/json' })
    expect(sensitivity.overflow).toBe(0)
    expect(sensitivity.traps.slice(beforeTraps.length)).toEqual([{ realm: 'parent', kind: 'textContent', at: expect.any(Number) }])
    expect(() => assertNoGetterEffects(beforeTraps, sensitivity.traps)).toThrow()
  } finally {
    await closeFixtureServer(server)
  }
})
