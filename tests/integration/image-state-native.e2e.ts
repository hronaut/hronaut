import { createServer } from 'node:http'
import { imageStateScript, imageStateSettlementScript } from '../../src/main/browser/image-state.js'
import { test, expect, closeFixtureServer } from './fixtures.js'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test('probes native image scalars without page accessors or loading mutations', async ({ electronApp }, info) => {
  const png = Buffer.from(await electronApp.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(Buffer.alloc(8 * 4 * 4, 255), { width: 8, height: 4 }).toPNG().toString('base64')), 'base64')
  const requests: string[] = []
  const server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://fixture')
    requests.push(url.pathname)
    if (url.pathname === '/pending') return
    if (url.pathname === '/broken') { response.writeHead(404); response.end('not image'); return }
    response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); response.end(png)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  try {
    const proof = await electronApp.evaluate(async ({ BrowserWindow }, { origin, pngBase64, scripts }) => {
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'image-state-proof' } })
      const page = window.webContents
      const read = async (selector: string) => {
        const pair = scripts[selector]!
        const result = await page.executeJavaScriptInIsolatedWorld(1022, [{ code: pair.read.replace('deadline=0', 'deadline=' + (Date.now() + 5000)) }], false)
        if (!result.failure) {
          const valid = await page.executeJavaScriptInIsolatedWorld(1022, [{ code: pair.settle }], false)
          if (valid !== true) throw new Error('Native image handle failed settlement')
        }
        return result
      }
      const html = `<!doctype html><input id="anchor"><img id="target" hidden><img id="lazy" loading="lazy" style="position:absolute;top:100000px" width="8" height="4"><script>
        const target=document.getElementById('target'),lazy=document.getElementById('lazy');globalThis.target=target;globalThis.lazy=lazy;
        globalThis.calls=0;globalThis.methods=0;globalThis.mutations=0;globalThis.focuses=0;
        const native=Object.fromEntries(['complete','naturalWidth','naturalHeight','currentSrc'].map(n=>[n,Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,n)]));
        globalThis.prepare=(kind)=>new Promise(resolve=>{
          target.onload=target.onerror=()=>resolve(true);
          if(kind==='missing'){target.removeAttribute('src');resolve(true)}
          else if(kind==='empty'){target.src='';resolve(true)}
          else if(kind==='data'){target.removeAttribute('srcset');target.src='data:image/png;base64,'+${JSON.stringify(pngBase64)}}
          else if(kind==='blob'){target.removeAttribute('srcset');target.src=URL.createObjectURL(new Blob([Uint8Array.from(atob(${JSON.stringify(pngBase64)}),c=>c.charCodeAt(0))],{type:'image/png'}))}
          else if(kind==='srcset'){target.removeAttribute('src');target.srcset=${JSON.stringify(origin + '/srcset?token=private-canary')}+' 1x'}
          else if(kind==='density'){target.removeAttribute('src');target.srcset=${JSON.stringify(origin + '/density?token=private-canary')}+' 2x'}
          else if(kind==='picture'){target.removeAttribute('srcset');const picture=document.createElement('picture'),source=document.createElement('source');source.srcset=${JSON.stringify(origin + '/picture?token=private-canary')};target.replaceWith(picture);picture.append(source,target)}
          else {target.src=${JSON.stringify(origin)}+'/'+kind+'?token=private-canary';if(kind==='pending')resolve(true)}
        });
        globalThis.poison=()=>{
          for(const n of Object.keys(native)){
            Object.defineProperty(HTMLImageElement.prototype,n,{get(){calls++;throw Error('page getter private-canary')},configurable:true});
            Object.defineProperty(target,n,{get(){calls++;throw Error('own getter private-canary')},configurable:true});
          }
          Object.defineProperty(target,Symbol.toPrimitive,{value:()=>{calls++;throw Error('page coercion')}});
          target.decode=()=>{methods++;throw Error('decode mutation')};
        };
        new MutationObserver(()=>mutations++).observe(document,{subtree:true,childList:true,attributes:true});document.addEventListener('focus',()=>focuses++,true);
      </script>`
      const rows: Array<{ scenario: string; state: unknown }> = []
      try {
        await page.loadURL('data:text/html,' + encodeURIComponent(html))
        rows.push({ scenario: 'missing', state: await read('#target') })
        await page.executeJavaScript("prepare('empty')"); rows.push({ scenario: 'empty', state: await read('#target') })
        await page.executeJavaScript("prepare('success')"); rows.push({ scenario: 'success', state: await read('#target') })
        await page.executeJavaScript('poison()')
        const before = await page.executeJavaScript('({calls,methods,mutations,focuses,x:scrollX,y:scrollY})')
        rows.push({ scenario: 'hostile-hidden', state: await read('#target') })
        const after = await page.executeJavaScript('({calls,methods,mutations,focuses,x:scrollX,y:scrollY})')
        for (const kind of ['broken', 'pending', 'srcset', 'density', 'data', 'blob', 'picture']) {
          await page.executeJavaScript(`prepare(${JSON.stringify(kind)})`)
          rows.push({ scenario: kind, state: await read('#target') })
        }
        await page.executeJavaScript(`lazy.src=${JSON.stringify(origin + '/lazy?token=private-canary')}`)
        rows.push({ scenario: 'lazy', state: await read('#lazy') })
        rows.push({ scenario: 'unsupported', state: await read('#anchor') })
        rows.push({ scenario: 'absent', state: await read('#absent') })
        await page.executeJavaScript("document.body.append(target.cloneNode())")
        rows.push({ scenario: 'ambiguous', state: await read('#target') })
        return { rows, before, after, hidden: !window.isVisible(), focused: window.isFocused(), runtime: { electron: process.versions.electron, chromium: process.versions.chrome, platform: process.platform }, calls: await page.executeJavaScript('({calls,methods})') }
      } finally { window.destroy() }
    }, { origin: `http://127.0.0.1:${address.port}`, pngBase64: png.toString('base64'), scripts: Object.fromEntries(['#target', '#lazy', '#anchor', '#absent'].map(selector => [selector, { read: imageStateScript(selector, selector, 0), settle: imageStateSettlementScript(selector) }])) })
    await info.attach('native-image-scalars', { body: JSON.stringify({ ...proof, requests }), contentType: 'application/json' })
    const state = (scenario: string) => proof.rows.find(r => r.scenario === scenario)!.state
    for (const scenario of ['missing', 'empty']) expect(state(scenario)).toMatchObject({ complete: true, naturalWidth: 0, naturalHeight: 0, hasSelectedSource: false })
    for (const scenario of ['success', 'hostile-hidden', 'srcset', 'data', 'blob', 'picture']) expect(state(scenario)).toMatchObject({ complete: true, naturalWidth: 8, naturalHeight: 4, hasSelectedSource: true })
    expect(state('density')).toMatchObject({ complete: true, naturalWidth: 4, naturalHeight: 2, hasSelectedSource: true })
    expect(state('broken')).toMatchObject({ complete: true, naturalWidth: 0, naturalHeight: 0, hasSelectedSource: true })
    expect(state('pending')).toMatchObject({ complete: false, naturalWidth: 0, naturalHeight: 0 })
    expect(state('lazy')).toMatchObject({ complete: false, naturalWidth: 0, naturalHeight: 0, hasSelectedSource: false })
    expect(requests).toEqual(['/success', '/broken', '/pending', '/srcset', '/density', '/picture'])
    expect(state('unsupported')).toEqual({ failure: 'unsupported-target' }); expect(state('absent')).toEqual({ failure: 'missing-target' }); expect(state('ambiguous')).toEqual({ failure: 'ambiguous-target' })
    expect(proof.before).toEqual(proof.after); expect(proof.calls).toEqual({ calls: 0, methods: 0 }); expect(proof.hidden).toBe(true); expect(proof.focused).toBe(false)
    expect(JSON.stringify(proof)).not.toMatch(/private-canary|data:image|blob:|base64/)
  } finally { await closeFixtureServer(server) }
})
