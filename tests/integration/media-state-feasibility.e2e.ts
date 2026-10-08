import { mediaStateScript, mediaStateSettlementScript } from '../../src/main/browser/media-state.js'
import { expect, test } from './fixtures.js'

// Synthetic feasibility gate only: no production tool, private media, captures or autoplay-policy changes.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test('acquires native scalar media state without page accessors or observation mutations', async ({ electronApp }) => {
  const proof = await electronApp.evaluate(async ({ BrowserWindow }, scripts) => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'media-scalar-proof' } })
    const page = window.webContents
    const names = ['paused', 'ended', 'seeking', 'muted', 'volume', 'playbackRate', 'currentTime', 'duration', 'readyState', 'networkState', 'error']
    const html = `<!doctype html><input id="anchor"><audio id="target" hidden></audio><video id="live" muted></video><canvas id="canvas" width="8" height="8"></canvas><script>
      globalThis.getterCalls=0;globalThis.methodCalls=0;globalThis.mutations=0;globalThis.focuses=0;globalThis.mediaMutations=0;
      const native=Object.fromEntries(${JSON.stringify(names)}.map(n=>[n,Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,n)]));
      const nativePlay=HTMLMediaElement.prototype.play, nativePause=HTMLMediaElement.prototype.pause;
      globalThis.nativeRead=n=>native[n].get.call(target);
      globalThis.prepare=()=>new Promise((resolve,reject)=>{
        const n=8000,bytes=new Uint8Array(44+n*2),v=new DataView(bytes.buffer);
        const word=(at,s)=>{for(let i=0;i<s.length;i++)bytes[at+i]=s.charCodeAt(i)};
        word(0,'RIFF');v.setUint32(4,36+n*2,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,n,true);v.setUint32(28,n*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,n*2,true);
        target.addEventListener('canplay',()=>resolve(true),{once:true});target.addEventListener('error',()=>reject(Error('fixture source failed')),{once:true});
        target.src=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
      });
      globalThis.playFixture=()=>nativePlay.call(target);
      globalThis.muteFixture=()=>{native.muted.set.call(target,true);native.volume.set.call(target,0)};
      globalThis.liveFixture=()=>new Promise(resolve=>{live.addEventListener('loadedmetadata',()=>resolve(true),{once:true});live.srcObject=canvas.captureStream(1);nativePlay.call(live).catch(()=>{});canvas.getContext('2d').fillRect(0,0,8,8)});
      globalThis.errorFixture=()=>new Promise(resolve=>{nativePause.call(target);target.addEventListener('error',()=>resolve(true),{once:true});target.src='data:audio/wav;base64,bm90LWF1ZGlv'});
      globalThis.poison=()=>{
        for(const n of ${JSON.stringify(names)}){
          Object.defineProperty(HTMLMediaElement.prototype,n,{get(){getterCalls++;throw Error('page getter')},set:native[n].set,configurable:true});
          Object.defineProperty(target,n,{get(){getterCalls++;throw Error('own getter')},configurable:true});
        }
        Object.defineProperty(target,Symbol.toPrimitive,{value:()=>{getterCalls++;throw Error('page coercion')}});
        Object.defineProperty(target,'currentSrc',{get(){getterCalls++;throw Error('private source getter')}});
        Object.defineProperty(MediaError.prototype,'message',{get(){getterCalls++;throw Error('private error message')}});
        Object.defineProperty(MediaError.prototype,'code',{get(){getterCalls++;throw Error('page error getter')},configurable:true});
        for(const n of ['play','pause','load'])target[n]=()=>{methodCalls++;throw Error('observation mutation')};
      };
      new MutationObserver(()=>mutations++).observe(document,{subtree:true,childList:true,attributes:true});
      document.addEventListener('focus',()=>focuses++,true);
      for(const type of ['play','pause','seeking','volumechange','loadstart','emptied'])document.addEventListener(type,()=>mediaMutations++,true);
    </script>`
    const read = async (selector = '#target') => {
      const value = await page.executeJavaScriptInIsolatedWorld(1020, [{ code: scripts[selector]!.read }], false)
      if (value?.failure) throw new Error('Synthetic target rejected')
      const settled = await page.executeJavaScriptInIsolatedWorld(1020, [{ code: scripts[selector]!.settle }], false)
      if (!settled) throw new Error('Synthetic media target did not settle')
      return value
    }
    const rejected = async (selector: string) => { try { await read(selector); return false } catch { return true } }
    const rows: { scenario: string; state: unknown }[] = []
    try {
      await page.loadURL('data:text/html,' + encodeURIComponent(html))
      rows.push({ scenario: 'unloaded', state: await read() })
      await page.executeJavaScript('prepare()', false)
      await page.executeJavaScript('poison()', false)
      const before = await page.executeJavaScript('({getterCalls,methodCalls,mutations,focuses,mediaMutations,x:scrollX,y:scrollY,active:document.activeElement===document.body})', false)
      for (let index = 0; index < 3; index++) rows.push({ scenario: 'ready-hidden', state: await read() })
      const after = await page.executeJavaScript('({getterCalls,methodCalls,mutations,focuses,mediaMutations,x:scrollX,y:scrollY,active:document.activeElement===document.body})', false)
      await page.executeJavaScript('muteFixture();playFixture()', true)
      await new Promise(resolve => setTimeout(resolve, 200))
      const mutationCount = await page.executeJavaScript('mediaMutations', false)
      rows.push({ scenario: 'progressing-muted', state: await read() })
      if (await page.executeJavaScript('mediaMutations', false) !== mutationCount) throw new Error('Observation mutated playback')
      await new Promise(resolve => setTimeout(resolve, 1100))
      rows.push({ scenario: 'ended', state: await read() })
      await page.executeJavaScript('liveFixture()', true)
      rows.push({ scenario: 'infinite', state: await read('#live') })
      await page.executeJavaScript('errorFixture()', false)
      rows.push({ scenario: 'error', state: await read() })
      await page.executeJavaScript("document.body.append(target.cloneNode());document.body.append(document.createElement('iframe'));const host=document.createElement('div');host.attachShadow({mode:'open'}).innerHTML='<audio id=shadow></audio>';document.body.append(host)", false)
      rows.push({ scenario: 'ambiguous', state: await rejected('#target') })
      rows.push({ scenario: 'non-media', state: await rejected('#anchor') })
      rows.push({ scenario: 'frame', state: await rejected('iframe') })
      rows.push({ scenario: 'shadow', state: await rejected('#shadow') })
      const calls = await page.executeJavaScript('({getterCalls,methodCalls})', false)
      return { rows, before, after, calls, hidden: !window.isVisible(), focused: window.isFocused() }
    } finally { window.destroy() }
  }, Object.fromEntries(['#target', '#live', '#anchor', 'iframe', '#shadow'].map(selector => [selector, { read: mediaStateScript({ selector }, selector), settle: mediaStateSettlementScript(selector) }])))
  const state = (scenario: string) => proof.rows.find(row => row.scenario === scenario)!.state as Record<string, unknown>
  expect(state('unloaded')).toMatchObject({ kind: 'audio', paused: true, readyState: 0, duration: { state: 'unknown' }, errorCode: null })
  expect(state('ready-hidden')).toMatchObject({ paused: true, duration: { state: 'finite', seconds: 1 }, errorCode: null })
  expect(state('progressing-muted')).toMatchObject({ paused: false, muted: true, volume: 0 })
  expect(state('progressing-muted').currentTime).toBeGreaterThan(0)
  expect(state('ended')).toMatchObject({ ended: true, paused: true })
  expect(state('infinite')).toMatchObject({ kind: 'video', duration: { state: 'infinite' } })
  expect(state('error')).toMatchObject({ errorCode: 4 })
  expect(state('ambiguous')).toBe(true)
  expect(state('non-media')).toBe(true)
  expect(state('frame')).toBe(true)
  expect(state('shadow')).toBe(true)
  expect(proof.after).toEqual(proof.before)
  expect(proof.calls).toEqual({ getterCalls: 0, methodCalls: 0 })
  expect(proof.hidden).toBe(true)
  expect(proof.focused).toBe(false)
  for (const row of proof.rows) {
    expect(JSON.stringify(row.state).length).toBeLessThan(1024)
    expect(JSON.stringify(row.state)).not.toMatch(/(?:currentSrc|data:|blob:|audio\/wav|message)/)
  }
})
