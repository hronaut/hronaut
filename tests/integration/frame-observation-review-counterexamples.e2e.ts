import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

for (const scenario of ['semantics', 'border-clip', 'parent-border-clip', 'independent-transform']) {
  test(`review counterexample: frame ${scenario}`, async ({ capabilities, electronApp }) => {
    const child = ['parent-border-clip','independent-transform'].includes(scenario) ? '<body style="margin:0;font:10px monospace">INVISIBLE_PREVIEW</body>' : scenario === 'semantics'
      ? '<h2>Preview heading</h2><button aria-label="ARIA_ONLY_LABEL" disabled style="width:60px;height:20px"></button><input type="checkbox" aria-label="CONSENT_LABEL" checked disabled value="PRIVATE_VALUE"><a href="https://user:PRIVATE_CREDENTIAL@example.test/path?token=PRIVATE_QUERY">Authored link</a>'
      : '<style>body{margin:0}#clip{position:relative;width:100px;height:10px;border:30px solid black;overflow:hidden}#hidden{position:absolute;top:20px;left:0;font:10px monospace;white-space:nowrap}</style><div id="clip"><span id="hidden">BORDER_CLIPPED</span></div>'
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'text/html')
      const parent=scenario==='parent-border-clip'
        ? '<body style="margin:0"><div style="position:relative;width:200px;height:50px;padding:10px;border:60px solid black;overflow:hidden"><iframe id="chosen" src="/child" style="position:absolute;top:70px;left:0;width:100px;height:30px;border:0"></iframe></div></body>'
        : `<iframe id="chosen" src="/child" ${scenario==='independent-transform'?'style="rotate:y 180deg;backface-visibility:hidden"':''}></iframe>`
      response.end(request.url === '/parent' ? parent : child)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    try {
      const nav = await capabilities.client.callTool({ name: 'browser_navigate', arguments: { tabId: capabilities.tabId, url: origin + '/parent' } }) as CallToolResult
      expect(nav.isError, text(nav)).not.toBe(true)
      if (scenario === 'border-clip') {
        const geometry = await electronApp.evaluate(async ({ webContents }, origin) => {
          const page = webContents.getAllWebContents().find(contents => contents.getURL() === origin + '/parent')!
          return page.executeJavaScript(`(()=>{const d=document.querySelector('#chosen').contentDocument,c=d.querySelector('#clip'),h=d.querySelector('#hidden'),r=c.getBoundingClientRect(),t=h.getBoundingClientRect();return {borderBottom:r.bottom,paddingBottom:r.top+c.clientTop+c.clientHeight,textTop:t.top,textBottom:t.bottom}})()`, false)
        }, origin) as { borderBottom: number; paddingBottom: number; textTop: number; textBottom: number }
        console.log('BORDER_CLIP_GEOMETRY', JSON.stringify(geometry))
        expect(geometry.textTop).toBeGreaterThanOrEqual(geometry.paddingBottom)
        expect(geometry.textBottom).toBeLessThanOrEqual(geometry.borderBottom)
      }
      const result = await capabilities.client.callTool({ name: 'browser_snapshot', arguments: { tabId: capabilities.tabId, frameSelector: '#chosen' } }) as CallToolResult
      if(['parent-border-clip','independent-transform'].includes(scenario)){console.log('REVIEW_COUNTEREXAMPLE',scenario,JSON.stringify(result));expect(result.isError,text(result)).toBe(true);return}
      expect(result.isError, text(result)).not.toBe(true)
      const output = JSON.stringify(result)
      console.log('REVIEW_COUNTEREXAMPLE', scenario, output)
      if (scenario === 'border-clip') expect(output).not.toContain('BORDER_CLIPPED')
      else {
        expect.soft(output).toContain('ARIA_ONLY_LABEL')
        expect.soft(output).toContain('CONSENT_LABEL')
        expect.soft(output).toContain('h2:')
        expect.soft(output).toContain('disabled')
        expect.soft(output).toContain('checked')
        expect.soft(output).toContain('example.test/path')
        expect(output).not.toMatch(/PRIVATE_VALUE|PRIVATE_CREDENTIAL|PRIVATE_QUERY/)
      }
    } finally { await closeFixtureServer(server) }
  })
}

test('review counterexample: pre-dispatch coverage contention does not retain a frame slot', async ({ capabilities, electronApp }) => {
  const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(q.url?.startsWith('/parent')?'<iframe id="chosen" src="/child"></iframe>':'<h1>Fresh frame</h1>')})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`
  const call=async(name:string,args:Record<string,unknown>)=>capabilities.client.callTool({name,arguments:{tabId:capabilities.tabId,...args}}) as Promise<CallToolResult>
  try{
    expect((await call('browser_navigate',{url:origin+'/parent'})).isError).not.toBe(true)
    expect((await call('browser_code_coverage',{action:'start',reload:false})).isError).not.toBe(true)
    await electronApp.evaluate(({webContents},origin)=>{
      const page=webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!,original=page.debugger.sendCommand.bind(page.debugger)
      const state={calls:[] as string[],restore:()=>{page.debugger.sendCommand=original}}
      ;(globalThis as typeof globalThis&{__frameReview?:typeof state}).__frameReview=state
      page.debugger.sendCommand=async(...args)=>{state.calls.push(args[0]);return original(...args)}
    },origin)
    const denied=await call('browser_snapshot',{frameSelector:'#chosen'})
    expect(denied.isError,text(denied)).toBe(true)
    const calls=await electronApp.evaluate(()=>{const state=(globalThis as typeof globalThis&{__frameReview:{calls:string[];restore():void}}).__frameReview;state.restore();return state.calls})
    console.log('PRE_DISPATCH_NATIVE_CALLS',JSON.stringify(calls));expect(calls).toEqual([])
    expect((await call('browser_code_coverage',{action:'stop'})).isError).not.toBe(true)
    const fresh=await call('browser_snapshot',{frameSelector:'#chosen'})
    console.log('POST_COVERAGE_FRAME',JSON.stringify(fresh))
    expect.soft(fresh.isError,text(fresh)).not.toBe(true)
    expect((await call('browser_navigate',{url:origin+'/parent?fresh'})).isError).not.toBe(true)
    const navigated=await call('browser_snapshot',{frameSelector:'#chosen'})
    console.log('POST_NAVIGATION_FRAME',JSON.stringify(navigated))
    expect(navigated.isError,text(navigated)).not.toBe(true)
  }finally{
    await electronApp.evaluate(()=>{const g=globalThis as typeof globalThis&{__frameReview?:{restore():void}};g.__frameReview?.restore();delete g.__frameReview}).catch(()=>undefined)
    await closeFixtureServer(server)
  }
})

test('review counterexample: sanitized text obeys requested maxChars', async ({ capabilities }) => {
  const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(q.url==='/parent'?'<iframe id="chosen" src="/child" style="width:900px;height:300px"></iframe>':'<body style="margin:8px;font:10px monospace;line-height:16px">'+'token:a '.repeat(110)+'</body>')})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`
  try{
    await capabilities.client.callTool({name:'browser_navigate',arguments:{tabId:capabilities.tabId,url:origin+'/parent'}})
    const result=await capabilities.client.callTool({name:'browser_snapshot',arguments:{tabId:capabilities.tabId,frameSelector:'#chosen',maxChars:1000}}) as CallToolResult
    expect(result.isError,text(result)).not.toBe(true)
    const snapshot=result.structuredContent as {text:string;completeness:{omissions:string[]}}
    console.log('SANITIZED_BOUNDS',JSON.stringify({returnedChars:snapshot.text.length,requestedChars:1000,omissions:snapshot.completeness.omissions}))
    expect.soft(snapshot.text.length).toBeLessThanOrEqual(1000)
    expect(snapshot.completeness.omissions).toContain('text-limit')
  }finally{await closeFixtureServer(server)}
})

type MutationGate={entered:boolean;calls:number;disconnects:number;release():void;restore():void;context?:string}
test('review counterexample: one mutation record has a bounded removed-node budget',async({capabilities,electronApp})=>{
  const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(q.url==='/parent'?'<iframe id="chosen" src="/child"></iframe><div id="noise"></div>':'<h1>Child</h1>')})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`
  let pending:Promise<CallToolResult>|undefined
  try{
    await capabilities.client.callTool({name:'browser_navigate',arguments:{tabId:capabilities.tabId,url:origin+'/parent'}})
    await electronApp.evaluate(({webContents},origin)=>{
      const page=webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!,original=page.debugger.sendCommand.bind(page.debugger)
      let release!:()=>void;const wait=new Promise<void>(r=>{release=r})
      const gate:MutationGate={entered:false,calls:0,disconnects:0,release,restore:()=>{page.debugger.sendCommand=original}}
      ;(globalThis as typeof globalThis&{__mutationGate?:MutationGate}).__mutationGate=gate
      page.debugger.sendCommand=async(method,params,session)=>{
        if(method==='Runtime.evaluate'&&String(params?.expression).includes('const started = performance.now()')){
          gate.context=params?.uniqueContextId
          const instrument=`this.__mutationMetrics={calls:0,disconnects:0};{const original=Node.prototype.contains;Node.prototype.contains=function(...args){__mutationMetrics.calls++;return original.apply(this,args)};const disconnect=MutationObserver.prototype.disconnect;MutationObserver.prototype.disconnect=function(){__mutationMetrics.disconnects++;return disconnect.call(this)}};`
          params={...params,expression:instrument+params?.expression}
        }
        if(method==='Runtime.releaseObjectGroup'&&String(params?.objectGroup).startsWith('hronaut-frame-')&&!gate.entered){gate.entered=true;await wait}
        return original(method,params,session)
      }
    },origin)
    pending=capabilities.client.callTool({name:'browser_snapshot',arguments:{tabId:capabilities.tabId,frameSelector:'#chosen'}}) as Promise<CallToolResult>
    await expect.poll(()=>electronApp.evaluate(()=>(globalThis as typeof globalThis&{__mutationGate:MutationGate}).__mutationGate.entered)).toBe(true)
    const metrics=await electronApp.evaluate(async({webContents},origin)=>{
      const page=webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!,gate=(globalThis as typeof globalThis&{__mutationGate:MutationGate}).__mutationGate
      await page.executeJavaScript(`(()=>{const noise=document.querySelector('#noise'),f=document.createDocumentFragment();for(let n=0;n<12000;n++)f.append(document.createElement('i'));noise.replaceChildren(f);noise.replaceChildren();return true})()`,false)
      const result=await page.debugger.sendCommand('Runtime.evaluate',{expression:'this.__mutationMetrics',uniqueContextId:gate.context,returnByValue:true})
      return result.result.value as {calls:number;disconnects:number}
    },origin)
    console.log('MUTATION_WORK',JSON.stringify(metrics))
    expect.soft(metrics.calls).toBeLessThanOrEqual(1000)
    expect.soft(metrics.disconnects).toBeGreaterThan(0)
    await electronApp.evaluate(()=>(globalThis as typeof globalThis&{__mutationGate:MutationGate}).__mutationGate.release())
    expect((await pending).isError).toBe(true)
  }finally{
    await electronApp.evaluate(()=>{const g=globalThis as typeof globalThis&{__mutationGate?:MutationGate};g.__mutationGate?.release();g.__mutationGate?.restore();delete g.__mutationGate}).catch(()=>undefined)
    await pending?.catch(()=>undefined)
    await closeFixtureServer(server)
  }
})
