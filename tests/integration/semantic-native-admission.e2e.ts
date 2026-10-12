import type { HronautApi } from '../../src/shared/types.js'
import { test, expect } from './capability-fixtures.js'

type Probe = { commands: Array<Record<string, unknown>>; cleanup: number; finals: number; restores(): void }
type Scope = typeof globalThis & { __admissionProbe?: Probe }
const setup = (mode: string) => `(() => {
 document.body.innerHTML='<button id="target" data-hronaut-ref="e987" style="position:fixed;left:120.125px;top:120.375px;width:200.5px;height:100.5px"><span id="child" style="display:block;width:100%;height:100%">Target</span></button>';
 const member=Node.prototype.contains;window.events=[];window.original=document.getElementById('target');window.overrides=0;
 const overlay=()=>{const n=document.createElement('button');n.id='overlay';n.textContent='private-blocker-canary';n.style='position:fixed;inset:0;z-index:999999';document.body.append(n)};window.overlay=overlay;
 for(const type of ['mousedown','mouseup','click','dblclick'])document.addEventListener(type,e=>{if(window.events.length<30)window.events.push({type,target:e.target.id,original:member.call(window.original,e.target),trusted:e.isTrusted})},true);
 if('${mode}'==='plain')window.original.textContent='Target';
 if('${mode}'==='fixed'||'${mode}'==='pass-through'){overlay();if('${mode}'==='pass-through')document.getElementById('overlay').style.pointerEvents='none'}
 if('${mode}'==='hover')document.addEventListener('mousemove',overlay,{once:true});
 if('${mode}'==='replace')document.addEventListener('mousemove',()=>{const n=window.original.cloneNode(true);window.original.replaceWith(n)},{once:true});
 if('${mode}'==='flag-replace')Object.defineProperty(window,'__hronautAgentInputActive',{configurable:true,set(value){if(value&&window.original.isConnected)window.original.replaceWith(window.original.cloneNode(true))}});
 if('${mode}'==='user-agent')document.getElementById('child').innerHTML='<input style="width:100%;height:100%" value="private-input-canary">';
 if('${mode}'==='second-block')window.original.addEventListener('click',overlay,{once:true});
 if('${mode}'==='closed'||'${mode}'==='open'){document.getElementById('child').attachShadow({mode:'${mode}' }).innerHTML='<button style="width:100%;height:100%">private-shadow-canary</button>'}
 if('${mode}'==='frame')document.getElementById('child').innerHTML='<iframe style="width:100%;height:100%;border:0" srcdoc="<button>Frame</button>"></iframe>';
 window.installOverrides=()=>{const bad=()=>{window.overrides++;throw Error('page override')};Document.prototype.elementFromPoint=bad;Document.prototype.querySelectorAll=bad;Node.prototype.contains=bad;Object.defineProperty(Node.prototype,'isConnected',{get:bad})};
 return true;
})()`
for (const target of ['selector','ref'] as const) for (const doubleClick of [false,true]) {
 for (const mode of ['plain','fixed','hover','descendant','pass-through','replace','closed','open','frame','hostile','flag-replace','user-agent','second-block']) {
  if (mode === 'second-block' && !doubleClick) continue
  test(`semantic admission ${target} double=${doubleClick} ${mode}`, async({capabilities,electronApp}, info)=>{
   const {client,tabId,fixtureUrl}=capabilities
   await electronApp.evaluate(async({webContents},{url,script})=>{await webContents.getAllWebContents().find(p=>p.getURL()===url)!.executeJavaScript(script)}, {url:fixtureUrl,script:setup(mode)})
   let ref: string | undefined
   if(target==='ref'){
    expect((await client.callTool({name:'browser_snapshot',arguments:{tabId}})).isError).not.toBe(true)
    ref=await electronApp.evaluate(async({webContents},url)=>webContents.getAllWebContents().find(p=>p.getURL()===url)!.executeJavaScript("document.getElementById('target').getAttribute('data-hronaut-ref')"),fixtureUrl)
    expect(ref).toBeTruthy()
   }
   if(mode==='hostile')await electronApp.evaluate(async({webContents},url)=>webContents.getAllWebContents().find(p=>p.getURL()===url)!.executeJavaScript('window.installOverrides();true'),fixtureUrl)
   const result=await client.callTool({name:'browser_click',arguments:{tabId,...(target==='selector'?{selector:'#target'}:{ref}),...(doubleClick?{doubleClick:true}:{native:true})}})
   const observed=await electronApp.evaluate(async({webContents},url)=>{const p=webContents.getAllWebContents().find(p=>p.getURL()===url)!;return p.executeJavaScript('({events:window.events,overrides:window.overrides})')},fixtureUrl)
   await info.attach('admission-observation',{body:JSON.stringify({target,doubleClick,mode,result,observed}),contentType:'application/json'})
   const blocked=['fixed','hover','replace','closed','open','frame','flag-replace','user-agent','second-block'].includes(mode)
   expect(result.isError===true).toBe(blocked)
   expect(JSON.stringify(result)).not.toMatch(/private-blocker-canary|private-shadow-canary|private-input-canary/)
   if(blocked){expect(result.structuredContent).toMatchObject({status:'OUTCOME_UNKNOWN',effects:'possible',retrySafe:false,progress:{downAttempted:mode==='second-block'?1:0,downAcknowledged:mode==='second-block'?1:0,upAcknowledged:mode==='second-block'?1:0,targetCleanup:'confirmed'}})}
   const clicks=observed.events.filter((e:{type:string})=>e.type==='click')
   expect(clicks).toHaveLength(mode==='second-block'?1:blocked?0:doubleClick?2:1)
   expect(clicks.every((e:{trusted:boolean;original:boolean})=>e.trusted&&e.original)).toBe(true)
   expect(observed.overrides).toBe(0)
  })
 }
}
for(const fault of ['post-sample-overlay','second-down-transport','relock','target-cleanup']){
 test(`semantic admission preserves ${fault}`,async({capabilities,electronApp,appWindow},info)=>{
  const {client,tabId,fixtureUrl}=capabilities
  if(fault==='relock')await appWindow.evaluate(id=>(window as unknown as {hronaut:HronautApi}).hronaut.setTabHumanInteractionLocked(id,true),tabId)
  await electronApp.evaluate(async({webContents},{url,script,fault})=>{
   const p=webContents.getAllWebContents().find(p=>p.getURL()===url)!;await p.executeJavaScript(script)
   const send=p.debugger.sendCommand.bind(p.debugger)
   const probe:Probe={commands:[],cleanup:0,finals:0,restores:()=>{p.debugger.sendCommand=send}};(globalThis as Scope).__admissionProbe=probe
   p.debugger.sendCommand=async(method,params,session)=>{
    const v=params as Record<string,unknown>|undefined
    if(method==='Input.dispatchMouseEvent'){
     probe.commands.push({...v})
     if(fault==='second-down-transport'&&v?.type==='mousePressed'&&probe.commands.filter(x=>x.type==='mousePressed').length===2)throw Error('injected raw down uncertainty')
    }
    if(method==='Runtime.releaseObjectGroup'&&String(v?.objectGroup).startsWith('hronaut-native-click-')){probe.cleanup++;if(fault==='target-cleanup')throw Error('injected handle cleanup failure')}
    const result=await send(method,params,session)
    if(method==='Runtime.callFunctionOn'&&String(v?.functionDeclaration).includes('this.sample')&&(v?.arguments as Array<{value:unknown}>)?.[2]?.value===true){probe.finals++;if(fault==='post-sample-overlay')await p.executeJavaScript('window.overlay();true')}
    if(fault==='relock'&&method==='Input.setIgnoreInputEvents'&&v?.ignore===true&&probe.commands.some(x=>x.type==='mousePressed')&&!probe.commands.some(x=>x.type==='mouseReleased'))throw Error('injected re-lock uncertainty')
    return result
   }
  },{url:fixtureUrl,script:setup('plain'),fault})
  try{
   const result=await client.callTool({name:'browser_click',arguments:{tabId,selector:'#target',...(fault==='second-down-transport'?{doubleClick:true}:{native:true})}})
   const observation=await electronApp.evaluate(async({webContents},url)=>{const p=webContents.getAllWebContents().find(p=>p.getURL()===url)!;const q=(globalThis as Scope).__admissionProbe!;return{commands:q.commands,cleanup:q.cleanup,finals:q.finals,events:await p.executeJavaScript('window.events')}},fixtureUrl)
   await info.attach('admission-fault',{body:JSON.stringify({fault,result,observation}),contentType:'application/json'})
   if(fault==='post-sample-overlay'){expect(result.isError).not.toBe(true);expect(observation.events.some((e:{type:string;target:string})=>e.type==='click'&&e.target==='overlay')).toBe(true)}
   else{expect(result.isError).toBe(true);expect(result.structuredContent).toMatchObject({status:'OUTCOME_UNKNOWN',retrySafe:false,progress:{downAttempted:fault==='second-down-transport'?2:1,downAcknowledged:1,upAcknowledged:1}})}
   expect(observation.cleanup).toBe(1)
   if(fault!=='post-sample-overlay'){
    const again=await client.callTool({name:'browser_click',arguments:{tabId,selector:'#target',native:true}})
    expect(again.isError).toBe(true)
    expect(again.structuredContent).toMatchObject({status:'NOT_DISPATCHED',effects:'none',reason:'CLICK_STATE_UNCONFIRMED',progress:{preparationAttempted:false,downAttempted:0,targetCleanup:'not-acquired'}})
    const after=await electronApp.evaluate(()=>{const p=(globalThis as Scope).__admissionProbe!;return{commands:p.commands,cleanup:p.cleanup}},undefined)
    expect(after).toEqual({commands:observation.commands,cleanup:observation.cleanup})
   }
  }finally{await electronApp.evaluate(()=>{(globalThis as Scope).__admissionProbe?.restores();delete(globalThis as Scope).__admissionProbe})}
 })
}

for (const variant of ['fractional', 'zoom', 'dpr', 'clipped', 'scroll', 'off-viewport'] as const) {
 test(`semantic admission viewport CSS coordinates ${variant}`, async ({capabilities,electronApp,appWindow},info) => {
  const {client,tabId,fixtureUrl}=capabilities
  if(variant==='dpr') await appWindow.evaluate(id=>(window as unknown as {hronaut:HronautApi}).hronaut.setTabViewport(id,{width:900,height:700,deviceScaleFactor:2,mobile:false,touch:false,orientation:'landscape'}),tabId)
  await electronApp.evaluate(async({webContents},{url,script,variant})=>{
   const p=webContents.getAllWebContents().find(p=>p.getURL()===url)!;await p.executeJavaScript(script)
   if(variant==='zoom')p.setZoomFactor(1.25)
   if(variant==='clipped')await p.executeJavaScript("window.original.style.left='-10.125px';true")
   if(variant==='scroll')await p.executeJavaScript("window.original.style.position='absolute';window.original.style.top='2400.375px';true")
   if(variant==='off-viewport')await p.executeJavaScript("window.original.style.left='-500.125px';true")
   const send=p.debugger.sendCommand.bind(p.debugger)
   const probe:Probe={commands:[],cleanup:0,finals:0,restores:()=>{p.debugger.sendCommand=send}};(globalThis as Scope).__admissionProbe=probe
   p.debugger.sendCommand=async(method,params,session)=>{
    const v=params as Record<string,unknown>|undefined
    if(method==='Input.dispatchMouseEvent')probe.commands.push({method,...v})
    if(method==='Runtime.callFunctionOn'&&String(v?.functionDeclaration).includes('this.sample'))probe.commands.push({method,...v})
    return send(method,params,session)
   }
  },{url:fixtureUrl,script:setup('plain'),variant})
  try{
   const result=await client.callTool({name:'browser_click',arguments:{tabId,selector:'#target',native:true}})
   const observation=await electronApp.evaluate(async({webContents},url)=>{
    const p=webContents.getAllWebContents().find(p=>p.getURL()===url)!
    return{commands:(globalThis as Scope).__admissionProbe!.commands,zoom:p.getZoomFactor(),page:await p.executeJavaScript('({events:window.events,dpr:devicePixelRatio})')}
   },fixtureUrl)
   await info.attach('viewport-coordinate-observation',{body:JSON.stringify({variant,result,observation}),contentType:'application/json'})
   if(variant==='off-viewport'){
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({progress:{downAttempted:0,upAttempted:0}})
    expect(observation.commands.some(p=>p.type==='mousePressed')).toBe(false)
    expect(observation.page.events).toHaveLength(0)
    return
   }
   expect(result.isError).not.toBe(true)
   const down=observation.commands.find(p=>p.type==='mousePressed')!
   expect(Number.isInteger(down.x)&&Number.isInteger(down.y)).toBe(false)
   const samples=observation.commands.filter(p=>p.method==='Runtime.callFunctionOn')
   expect(samples).toHaveLength(2)
   for(const sample of samples)expect((sample.arguments as Array<{value:unknown}>).slice(0,2)).toEqual([{value:down.x},{value:down.y}])
   expect(observation.page.events.filter((e:{type:string})=>e.type==='click')).toEqual([expect.objectContaining({original:true,trusted:true})])
   if(variant==='zoom')expect(observation.zoom).toBe(1.25)
   if(variant==='dpr')expect(observation.page.dpr).toBe(2)
  }finally{await electronApp.evaluate(()=>{(globalThis as Scope).__admissionProbe?.restores();delete(globalThis as Scope).__admissionProbe})}
 })
}

test('semantic admission remains reserved through renderer cleanup and taints after failure', async ({capabilities,electronApp},info) => {
 const {client,tabId,fixtureUrl}=capabilities
 type CleanupScope = typeof globalThis & { __clickCleanup?: { ready:boolean; downs:number; acquisitions:number; release():void; restore():void } }
 await electronApp.evaluate(async({webContents},{url,script})=>{
  const p=webContents.getAllWebContents().find(p=>p.getURL()===url)!;await p.executeJavaScript(script)
  const execute=p.executeJavaScript.bind(p),send=p.debugger.sendCommand.bind(p.debugger)
  let release!:()=>void
  const barrier=new Promise<void>(resolve=>{release=resolve})
  const gate={ready:false,downs:0,acquisitions:0,release,restore:()=>{p.executeJavaScript=execute;p.debugger.sendCommand=send}}
  ;(globalThis as CleanupScope).__clickCleanup=gate
  p.executeJavaScript=async(script,...args)=>{
   if(script==='delete window.__hronautAgentInputActive'){gate.ready=true;await barrier;throw Error('injected renderer cleanup rejection')}
   return execute(script,...args)
  }
  p.debugger.sendCommand=async(method,params,session)=>{
   const v=params as Record<string,unknown>|undefined
   if(method==='Input.dispatchMouseEvent'&&v?.type==='mousePressed')gate.downs++
   if(method==='Runtime.evaluate'&&String(v?.objectGroup).startsWith('hronaut-native-click-'))gate.acquisitions++
   return send(method,params,session)
  }
 },{url:fixtureUrl,script:setup('plain')})
 const pending=client.callTool({name:'browser_click',arguments:{tabId,selector:'#target',native:true}})
 try{
  await expect.poll(()=>electronApp.evaluate(()=>(globalThis as CleanupScope).__clickCleanup!.ready)).toBe(true)
  const concurrent=await client.callTool({name:'browser_click',arguments:{tabId,selector:'#target',native:true}})
  expect(concurrent.isError).toBe(true)
  expect(concurrent.structuredContent).toMatchObject({status:'BUSY',effects:'none',reason:'WORKSPACE_BUSY'})
  const other=await client.callTool({name:'browser_press',arguments:{tabId,key:'Enter'}})
  expect(other.isError).toBe(true)
  expect(other.structuredContent).toMatchObject({status:'BUSY',effects:'none',reason:'WORKSPACE_BUSY'})
  await electronApp.evaluate(()=>(globalThis as CleanupScope).__clickCleanup!.release())
  const first=await pending
  expect(first.isError).toBe(true)
  expect(first.structuredContent).toMatchObject({status:'OUTCOME_UNKNOWN',progress:{inputCleanupFailed:true,downAcknowledged:1,upAcknowledged:1}})
  const after=await client.callTool({name:'browser_click',arguments:{tabId,selector:'#target',native:true}})
  expect(after.structuredContent).toMatchObject({status:'NOT_DISPATCHED',reason:'CLICK_STATE_UNCONFIRMED'})
  const observed=await electronApp.evaluate(async({webContents},id)=>{
   const gate=(globalThis as CleanupScope).__clickCleanup!
   const home=webContents.getAllWebContents().find(p=>p.getURL().startsWith('hronaut://home'))!
   const state=await (await home.session.fetch('hronaut://home/api/status')).json() as {recentActivity:Array<{toolName:string;tabId:string;result:unknown}>}
   return{downs:gate.downs,acquisitions:gate.acquisitions,activities:state.recentActivity.filter(a=>a.toolName==='browser_click'&&a.tabId===id)}
  },tabId)
  expect(observed.downs).toBe(1);expect(observed.acquisitions).toBe(1)
  expect(observed.activities).toHaveLength(2)
  expect(observed.activities.filter(a=>(a.result as {effects:string}).effects==='none')).toHaveLength(1)
  await info.attach('pending-cleanup-admission',{body:JSON.stringify({first,concurrent,after,observed}),contentType:'application/json'})
 }finally{
  await electronApp.evaluate(()=>{const g=(globalThis as CleanupScope).__clickCleanup;g?.release();g?.restore();delete(globalThis as CleanupScope).__clickCleanup})
  await pending.catch(()=>undefined)
 }
})

test('semantic admission respects a generic input operation pending cleanup', async ({capabilities,electronApp},info) => {
 const {client,tabId,fixtureUrl}=capabilities
 type GenericScope = typeof globalThis & { __genericCleanup?: {ready:boolean; downs:number; acquisitions:number; release():void; restore():void} }
 await electronApp.evaluate(async({webContents},{url,script})=>{
  const p=webContents.getAllWebContents().find(p=>p.getURL()===url)!;await p.executeJavaScript(script)
  const execute=p.executeJavaScript.bind(p),send=p.debugger.sendCommand.bind(p.debugger)
  let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve})
  const gate={ready:false,downs:0,acquisitions:0,release,restore:()=>{p.executeJavaScript=execute;p.debugger.sendCommand=send}}
  ;(globalThis as GenericScope).__genericCleanup=gate
  p.executeJavaScript=async(script,...args)=>{if(script==='delete window.__hronautAgentInputActive'){gate.ready=true;await barrier}return execute(script,...args)}
  p.debugger.sendCommand=async(method,params,session)=>{
   const v=params as Record<string,unknown>|undefined
   if(method==='Input.dispatchMouseEvent'&&v?.type==='mousePressed')gate.downs++
   if(method==='Runtime.evaluate'&&String(v?.objectGroup).startsWith('hronaut-native-click-'))gate.acquisitions++
   return send(method,params,session)
  }
 },{url:fixtureUrl,script:setup('plain')})
 const pending=client.callTool({name:'browser_press',arguments:{tabId,key:'Enter'}})
 try{
  await expect.poll(()=>electronApp.evaluate(()=>(globalThis as GenericScope).__genericCleanup!.ready)).toBe(true)
  const result=await client.callTool({name:'browser_click',arguments:{tabId,selector:'#target',native:true}})
  expect(result.isError).toBe(true)
  expect(result.structuredContent).toMatchObject({status:'BUSY',effects:'none',reason:'WORKSPACE_BUSY'})
  const observed=await electronApp.evaluate(()=>{const p=(globalThis as GenericScope).__genericCleanup!;return{downs:p.downs,acquisitions:p.acquisitions}})
  expect(observed).toEqual({downs:0,acquisitions:0})
  await electronApp.evaluate(()=>(globalThis as GenericScope).__genericCleanup!.release())
  expect((await pending).isError).not.toBe(true)
  await info.attach('generic-cleanup-exclusion',{body:JSON.stringify({result,observed}),contentType:'application/json'})
 }finally{
  await electronApp.evaluate(()=>{const g=(globalThis as GenericScope).__genericCleanup;g?.release();g?.restore();delete(globalThis as GenericScope).__genericCleanup})
  await pending.catch(()=>undefined)
 }
})

for(const doubleClick of [false,true]) test(`semantic admission permits an explicit fresh request after overlay removal double=${doubleClick}`, async({capabilities,electronApp},info)=>{
 const {client,tabId,fixtureUrl}=capabilities
 await electronApp.evaluate(async({webContents},{url,script})=>webContents.getAllWebContents().find(p=>p.getURL()===url)!.executeJavaScript(script),{url:fixtureUrl,script:setup('fixed')})
 const blocked=await client.callTool({name:'browser_click',arguments:{tabId,selector:'#target',...(doubleClick?{doubleClick:true}:{native:true})}})
 expect(blocked.isError).toBe(true)
 expect(blocked.structuredContent).toMatchObject({reason:'TARGET_OCCLUDED',progress:{downAttempted:0,upAttempted:0,targetCleanup:'confirmed'}})
 await electronApp.evaluate(async({webContents},url)=>webContents.getAllWebContents().find(p=>p.getURL()===url)!.executeJavaScript("document.getElementById('overlay').remove();true"),fixtureUrl)
 expect((await client.callTool({name:'browser_snapshot',arguments:{tabId}})).isError).not.toBe(true)
 const ref=await electronApp.evaluate(async({webContents},url)=>webContents.getAllWebContents().find(p=>p.getURL()===url)!.executeJavaScript("window.original.getAttribute('data-hronaut-ref')"),fixtureUrl)
 expect(ref).toBeTruthy()
 const fresh=await client.callTool({name:'browser_click',arguments:{tabId,ref,...(doubleClick?{doubleClick:true}:{native:true})}})
 expect(fresh.isError).not.toBe(true)
 const observed=await electronApp.evaluate(async({webContents},url)=>webContents.getAllWebContents().find(p=>p.getURL()===url)!.executeJavaScript('window.events'),fixtureUrl)
 const clicks=observed.filter((event:{type:string})=>event.type==='click')
 expect(clicks).toHaveLength(doubleClick?2:1)
 expect(clicks.every((event:{trusted:boolean;original:boolean})=>event.trusted&&event.original)).toBe(true)
 await info.attach('explicit-fresh-request',{body:JSON.stringify({blocked,fresh,observed}),contentType:'application/json'})
})
