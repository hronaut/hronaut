import { readFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication } from '@playwright/test'
import type { HronautApi, HronautMcpApi, HronautSettingsApi } from '../../src/shared/types.js'
import type { BrowserVideoState } from '../../src/shared/video.js'
import type { VideoInspectionReport } from '../../src/shared/video-inspection.js'
import { expect, test, text } from './capability-fixtures.js'
type TestWindow = Window & { hronaut: HronautApi; hronautMcp: HronautMcpApi; hronautSettings: HronautSettingsApi }
const request = (state: BrowserVideoState) => ({ action:'inspect',recordingId:state.recordingId,expectedRevision:state.timing!.revision,startMs:0,endMs:state.durationMs,maxFrames:12 })
const video = (client: Client, tabId: string, action: string, extra: Record<string,unknown> = {}) => client.callTool({name:'browser_video',arguments:{tabId,action,...extra}}) as Promise<CallToolResult>
async function stopped(client: Client, tabId: string): Promise<BrowserVideoState> {
  const start=await video(client,tabId,'start');expect(start.isError,text(start)).not.toBe(true)
  await expect.poll(async()=>JSON.parse(text(await video(client,tabId,'get'))).frameCount).toBeGreaterThanOrEqual(1)
  const stop=await video(client,tabId,'stop');expect(stop.isError,text(stop)).not.toBe(true)
  return JSON.parse(text(stop)) as BrowserVideoState
}
interface Hook { held:boolean; release?:()=>void; restore:()=>void }
async function holdFrame(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({app})=>{
    const restores:(()=>void)[]=[]
    const hook:Hook={held:false,restore:()=>{app.removeListener('web-contents-created',listener);for(const restore of restores)restore();hook.release?.()}}
    const listener=(_event:Electron.Event,contents:Electron.WebContents)=>{
      const original=contents.executeJavaScript
      contents.executeJavaScript=async function(...args:Parameters<Electron.WebContents['executeJavaScript']>){
        const result:unknown=await original.apply(this,args)
        if(args[0].startsWith('window.hronautVideoInspection.frame')&&!hook.held){hook.held=true;await new Promise<void>(resolve=>{hook.release=resolve})}
        return result
      }
      restores.push(()=>{contents.executeJavaScript=original})
    }
    app.on('web-contents-created',listener)
    ;(globalThis as typeof globalThis & {__videoInspectHook?:Hook}).__videoInspectHook=hook
  })
}
async function held(electronApp: ElectronApplication): Promise<void> {
  await expect.poll(()=>electronApp.evaluate(()=>(globalThis as typeof globalThis & {__videoInspectHook?:Hook}).__videoInspectHook?.held)).toBe(true)
}
async function release(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(()=>{const globals=globalThis as typeof globalThis & {__videoInspectHook?:Hook};globals.__videoInspectHook?.restore();delete globals.__videoInspectHook})
}

test('inspects actual retained source pixels with metadata and leaves composition and export unchanged',async({capabilities,appWindow})=>{
  const {client,tabId}=capabilities
  await client.callTool({name:'browser_evaluate',arguments:{tabId,script:"document.body.replaceChildren(); document.body.style.background='#ff0000'; new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))"}})
  const state=await stopped(client,tabId)
  for(const extra of [{recordingId:crypto.randomUUID()},{expectedRevision:state.timing!.revision+1},{maxFrames:13},{endMs:state.durationMs+1}])expect((await video(client,tabId,'inspect',{...request(state),...extra})).isError).toBe(true)
  const edit=await video(client,tabId,'edit',{annotations:[{kind:'highlight',startMs:0,endMs:state.durationMs,x:0.1,y:0.1,endX:0.9,endY:0.9}]})
  expect(edit.isError,text(edit)).not.toBe(true)
  const exported=JSON.parse(text(await video(client,tabId,'export'))) as BrowserVideoState
  const bytes=await readFile(exported.exported!.path)
  const result=await video(client,tabId,'inspect',request(exported))
  expect(result.isError,text(result)).not.toBe(true)
  const report=JSON.parse(text(result)) as VideoInspectionReport
  expect(report).toMatchObject({recordingId:state.recordingId,revision:exported.timing!.revision,status:'sheet',retainedFrames:state.frameCount,pixelTime:'unknown'})
  expect(report.frames[0]).toMatchObject({label:1,sequence:1,sourceTimeMs:0})
  expect(report.omittedFrames+report.selectedFrames).toBe(state.frameCount)
  const images=result.content.filter(item=>item.type==='image');expect(images).toHaveLength(1)
  const image=images[0]!;if(image.type!=='image')throw Error('No image')
  expect(Buffer.from(image.data,'base64').length).toBeLessThanOrEqual(4*1024*1024)
  const observed=await appWindow.evaluate(async base64=>{
    const image=await createImageBitmap(new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'image/png'}))
    try{const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d')!;context.drawImage(image,0,0);return {width:image.width,height:image.height,pixel:[...context.getImageData(256,144,1,1).data]}}finally{image.close()}
  },image.data)
  expect(observed).toMatchObject({width:report.image!.width,height:report.image!.height})
  expect(observed.pixel[0]).toBeGreaterThan(220);expect(observed.pixel[1]).toBeLessThan(30)
  const after=JSON.parse(text(await video(client,tabId,'get'))) as BrowserVideoState
  expect({...after,timing:undefined}).toEqual({...exported,timing:undefined});expect(after.timing!.revision).toBe(exported.timing!.revision)
  expect(await readFile(exported.exported!.path)).toEqual(bytes)
  const empty=await video(client,tabId,'inspect',{...request(after),startMs:1,endMs:1})
  expect(empty.content.some(item=>item.type==='image')).toBe(false);expect(JSON.parse(text(empty)).status).toBe('empty')
})

for(const boundary of ['clear','clear-new','edit','close','origin','workspace','pause'] as const){
  test(`discards actual inspect pixels after ${boundary}`,async({capabilities,appWindow,electronApp})=>{
    const {client,tabId}=capabilities;const state=await stopped(client,tabId)
    await holdFrame(electronApp)
    const pending=video(client,tabId,'inspect',request(state))
    try{
      await held(electronApp)
      await appWindow.evaluate(async({tabId,boundary})=>{
        const api=(window as unknown as TestWindow).hronaut
        if(boundary==='clear'||boundary==='clear-new')await api.manageVideo({tabId,action:'clear'})
        if(boundary==='clear-new'){await api.manageVideo({tabId,action:'start'});await api.manageVideo({tabId,action:'stop'})}
        if(boundary==='edit')await api.manageVideo({tabId,action:'edit',annotations:[]})
        if(boundary==='close')await api.closeTab(tabId)
        if(boundary==='origin')await api.navigate({tabId,url:'about:blank'})
        if(boundary==='workspace'){const state=await api.getState();await api.closeWorkspace(state.tabs.find(tab=>tab.id===tabId)!.mcpGroupId!)}
        if(boundary==='pause')await (window as unknown as TestWindow).hronautMcp.setPaused(true)
      },{tabId,boundary})
      await release(electronApp)
      const result=await pending;expect(result.isError).toBe(true);expect(result.content.some(item=>item.type==='image')).toBe(false)
    }finally{await release(electronApp);await pending.catch(()=>undefined);await appWindow.evaluate(()=>(window as unknown as TestWindow).hronautMcp.setPaused(false))}
  })
}
for(const mode of ['timeout','crash'] as const){
  test(`bounds busy inspection and recovers after ${mode}`,async({capabilities,electronApp})=>{
    const {client,tabId}=capabilities,state=await stopped(client,tabId)
    await holdFrame(electronApp)
    const pending=video(client,tabId,'inspect',request(state))
    try{
      await held(electronApp)
      const busy=await video(client,tabId,'inspect',request(state));expect(busy.isError).toBe(true);expect(text(busy)).toContain('already running')
      if(mode==='crash')await electronApp.evaluate(({webContents})=>webContents.getAllWebContents().find(contents=>contents.getURL().includes('video-inspection.html'))!.forcefullyCrashRenderer())
      const result=await pending;expect(result.isError).toBe(true);expect(result.content.some(item=>item.type==='image')).toBe(false)
      if(mode==='timeout')expect(text(result)).toContain('five-second')
      await release(electronApp)
      await expect.poll(()=>electronApp.evaluate(({webContents})=>webContents.getAllWebContents().filter(contents=>contents.getURL().includes('video-inspection.html')).length)).toBe(0)
      const next=await video(client,tabId,'inspect',request(state));expect(next.isError,text(next)).not.toBe(true)
    }finally{await release(electronApp);await pending.catch(()=>undefined)}
  })
}
test('revokes an actual capability while an inspection is pending',async({capabilities,appWindow,electronApp,mcpPort})=>{
  const credential=await appWindow.evaluate(origin=>(window as unknown as TestWindow).hronautSettings.createMcpCapabilityProfile({name:'Video inspection test',preset:'complete',origins:[origin]}),capabilities.fixtureOrigin)
  const client=new Client({name:'video-inspection',version:'1'})
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`),{requestInit:{headers:{authorization:`Bearer ${credential.credential}`}}}))
  let pending:Promise<CallToolResult>|undefined
  try{
    const workspace=await client.callTool({name:'browser_workspaces',arguments:{action:'create',name:'Inspection',storage:'scratch'}}) as CallToolResult
    expect(workspace.isError,text(workspace)).not.toBe(true)
    const workspaceId=JSON.parse(text(workspace)).id as string
    const browser=await appWindow.evaluate(({url,workspaceId})=>(window as unknown as TestWindow).hronaut.newTab({url,active:true,mcpGroupId:workspaceId}),{url:capabilities.fixtureUrl,workspaceId})
    const tabId=browser.activeTabId!
    const call=(action:string,extra:Record<string,unknown>={})=>client.callTool({name:'browser_video',arguments:{workspaceId,tabId,action,...extra}}) as Promise<CallToolResult>
    expect((await call('start')).isError).not.toBe(true)
    await expect.poll(async()=>JSON.parse(text(await call('get'))).frameCount).toBeGreaterThan(0)
    const state=JSON.parse(text(await call('stop'))) as BrowserVideoState
    await holdFrame(electronApp);pending=call('inspect',request(state));await held(electronApp)
    await appWindow.evaluate(id=>(window as unknown as TestWindow).hronautSettings.revokeMcpCapabilityProfile(id),credential.profile.id)
    await release(electronApp)
    const result=await pending;expect(result.isError).toBe(true);expect(result.content.some(item=>item.type==='image')).toBe(false)
  }finally{await release(electronApp);await pending?.catch(()=>undefined);await client.close()}
})

for(const bound of ['dimensions','aggregate','png'] as const){
  test(`rejects actual retained ${bound} bounds without returning pixels`,async({capabilities,electronApp})=>{
    const {client,tabId,fixtureUrl}=capabilities
    // Replace only recorder capture responses with generated pixels; thumbnail/page data stays untouched.
    await electronApp.evaluate(({webContents,nativeImage},{url,bound})=>{
      const page=webContents.getAllWebContents().find(contents=>contents.getURL()===url)!
      const original=page.capturePage.bind(page)
      const width=bound==='aggregate'?1280:512,height=bound==='aggregate'?720:288
      const pixels=Buffer.alloc(width*height*4);let seed=42
      page.capturePage=async(...args:Parameters<Electron.WebContents['capturePage']>)=>{
        if(!args[1]?.stayHidden||!args[1]?.stayAwake)return original(...args)
      for(let offset=0;offset<pixels.length;offset+=4){for(let channel=0;channel<3;channel++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels[offset+channel]=seed>>>24}pixels[offset+3]=255}
        const image=nativeImage.createFromBitmap(pixels,{width,height}),resize=image.resize.bind(image)
        image.resize=options=>{
          const resized=resize(options),encode=resized.toJPEG.bind(resized)
          resized.toJPEG=()=>{
            const bytes=encode(bound==='aggregate'?100:95)
            if(bound==='dimensions')for(let i=2;i<bytes.length-8;i++){if(bytes[i]===255&&bytes[i+1]===192){bytes.writeUInt16BE(2000,i+7);break}}
            return bytes
          }
          return resized
        }
        return image
      }
      ;(globalThis as typeof globalThis & {__restoreVideoFixture?:()=>void}).__restoreVideoFixture=()=>{page.capturePage=original}
    },{url:fixtureUrl,bound})
    try{
      expect((await video(client,tabId,'start')).isError).not.toBe(true)
      await expect.poll(async()=>JSON.parse(text(await video(client,tabId,'get'))).frameCount).toBeGreaterThanOrEqual(bound==='dimensions'?1:12)
      const state=JSON.parse(text(await video(client,tabId,'stop'))) as BrowserVideoState
      const result=await video(client,tabId,'inspect',request(state))
      expect(result.isError).toBe(true);expect(result.content.some(item=>item.type==='image')).toBe(false)
      expect(text(result)).toContain(bound==='dimensions'?'JPEG':bound==='aggregate'?'8 MiB':'4 MiB')
      expect(await electronApp.evaluate(({webContents})=>webContents.getAllWebContents().filter(contents=>contents.getURL().includes('video-inspection.html')).length)).toBe(0)
    }finally{
      await electronApp.evaluate(()=>{const globals=globalThis as typeof globalThis & {__restoreVideoFixture?:()=>void};globals.__restoreVideoFixture?.();delete globals.__restoreVideoFixture})
    }
  })
}
