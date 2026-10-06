import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautSettingsApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'
type Gate={entered:boolean;releases:number;release():void;restore():void}

for(const variant of ['timeout','contention','poisoned-getters'])test(`frame observation preserves ownership and isolation for ${variant}`,async({capabilities,electronApp,appWindow})=>{
  const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(q.url?.startsWith('/parent')?'<h1>Parent sentinel</h1><iframe id="chosen" src="/child"></iframe>':'<h1>Isolated child sentinel</h1>')})
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`
  const read=()=>capabilities.client.callTool({name:'browser_snapshot',arguments:{tabId:capabilities.tabId,frameSelector:'#chosen'}}) as Promise<CallToolResult>
  try{
    await capabilities.client.callTool({name:'browser_navigate',arguments:{tabId:capabilities.tabId,url:origin+'/parent'}})
    if(variant==='contention'){
      await appWindow.evaluate(id=>(window as unknown as {hronaut:{toggleDevTools(id:string):Promise<unknown>}}).hronaut.toggleDevTools(id),capabilities.tabId)
      const denied=await read();expect(denied.isError).toBe(true)
      expect(await electronApp.evaluate(({webContents},origin)=>webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!.debugger.isAttached(),origin)).toBe(false)
    }else if(variant==='poisoned-getters'){
      await electronApp.evaluate(async({webContents},origin)=>webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!.executeJavaScript(`(()=>{window.traps=[];const f=document.querySelector('#chosen'),child=f.contentWindow;for(const realm of [window,child]){Object.defineProperty(realm.Node.prototype,'textContent',{get(){window.traps.push({kind:'textContent',stack:new Error().stack.slice(0,1500)});throw Error('trap')}});Object.defineProperty(realm.HTMLElement.prototype,'innerText',{get(){window.traps.push({kind:'innerText',stack:new Error().stack.slice(0,1500)});throw Error('trap')}})}Object.defineProperty(f,'contentDocument',{get(){window.traps.push({kind:'contentDocument',stack:new Error().stack.slice(0,1500)});return document}});return true})()`,false),origin)
      // Control: observe the harness's asynchronous initial iframe preview
      // without issuing any MCP frame read.
      await expect.poll(()=>electronApp.evaluate(async({webContents},origin)=>webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!.executeJavaScript('window.traps.length',false),origin)).toBeGreaterThan(0)
      const beforeTraps=await electronApp.evaluate(async({webContents},origin)=>webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!.executeJavaScript('window.traps',false),origin)
      console.log('FRAME_GETTER_BEFORE',JSON.stringify(beforeTraps))
      // Playwright's setup preview can touch a node before the operation.
      // Reset only that setup evidence; the MCP call must add zero getters.
      await electronApp.evaluate(async({webContents},origin)=>webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!.executeJavaScript('window.traps=[];true',false),origin)
      const result=await read();expect(result.isError,text(result)).not.toBe(true);expect(text(result)).toContain('Isolated child sentinel');expect(text(result)).not.toContain('Parent sentinel')
      const afterTraps=await electronApp.evaluate(async({webContents},origin)=>webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!.executeJavaScript('window.traps',false),origin)
      console.log('FRAME_GETTER_AFTER',JSON.stringify(afterTraps))
      expect(afterTraps).toEqual([])
    }else{
      await electronApp.evaluate(({webContents},origin)=>{
        const p=webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!,original=p.debugger.sendCommand.bind(p.debugger)
        let release!:()=>void;const wait=new Promise<void>(r=>{release=r})
        const gate:Gate={entered:false,releases:0,release,restore:()=>{p.debugger.sendCommand=original}}
        ;(globalThis as typeof globalThis&{__frameNativeGate?:Gate}).__frameNativeGate=gate
        p.debugger.sendCommand=async(method,params,session)=>{
          if(method==='Runtime.evaluate'&&String(params?.expression).includes('].read()')&&!gate.entered){gate.entered=true;await wait}
          const result=await original(method,params,session)
          if(method==='Runtime.releaseObjectGroup'&&String(params?.objectGroup).startsWith('hronaut-frame-'))gate.releases++
          return result
        }
      },origin)
      const pending=read()
      await expect.poll(()=>electronApp.evaluate(()=>(globalThis as typeof globalThis&{__frameNativeGate:Gate}).__frameNativeGate.entered)).toBe(true)
      expect((await pending).isError).toBe(true)
      expect((await read()).isError).toBe(true)
      expect(await electronApp.evaluate(()=>(globalThis as typeof globalThis&{__frameNativeGate:Gate}).__frameNativeGate.releases)).toBe(0)
      await electronApp.evaluate(()=>(globalThis as typeof globalThis&{__frameNativeGate:Gate}).__frameNativeGate.release())
      await expect.poll(()=>electronApp.evaluate(()=>(globalThis as typeof globalThis&{__frameNativeGate:Gate}).__frameNativeGate.releases)).toBeGreaterThan(0)
      const current=await read();expect(current.isError,text(current)).not.toBe(true)
    }
  }finally{
    await electronApp.evaluate(()=>{const m=globalThis as typeof globalThis&{__frameNativeGate?:Gate};m.__frameNativeGate?.release();m.__frameNativeGate?.restore();delete m.__frameNativeGate}).catch(()=>undefined)
    await closeFixtureServer(server)
  }
})

test('read-only scoped grants can observe frames and revocation discards an in-flight final check',async({capabilities,electronApp,appWindow,mcpPort})=>{
  const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(q.url?.startsWith('/parent')?'<iframe id="chosen" src="/child"></iframe>':'<h1>Read grant child</h1>')})
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`
  const client=new Client({name:'frame-read-only',version:'1'})
  try{
    const created=await capabilities.client.callTool({name:'browser_workspaces',arguments:{action:'create',storage:'scratch',name:'Frame read grant'}}) as CallToolResult
    const workspace=JSON.parse(text(created)) as {id:string;resumeKey:string}
    await appWindow.evaluate('window.hronautSettings.setMcpAuthentication(true)')
    const profile=await appWindow.evaluate(({id,origin})=>(window as unknown as {hronautSettings:HronautSettingsApi}).hronautSettings.createMcpCapabilityProfile({name:'Frame read-only',preset:'read-only',workspaceIds:[id],origins:[origin],expiresInMinutes:60}),{id:workspace.id,origin})
    // The human creates the page; this credential gets no navigation/write grant.
    const state=await appWindow.evaluate(({workspaceId,url})=>(window as unknown as {hronaut:{newTab(options:{url:string;mcpGroupId:string;active:boolean}):Promise<{activeTabId:string}>}}).hronaut.newTab({url,mcpGroupId:workspaceId,active:true}),{workspaceId:workspace.id,url:origin+'/parent'})
    const tabId=state.activeTabId
    await expect.poll(()=>electronApp.evaluate(({webContents},origin)=>webContents.getAllWebContents().some(p=>p.getURL()===origin+'/parent'&&!p.isLoading()&&p.debugger.isAttached()),origin)).toBe(true)
    // Fixture waits for ordinary diagnostics to be enabled, then a native reload
    // supplies fresh history. Neither operation belongs to the read-only tool.
    await electronApp.evaluate(async({webContents},origin)=>{const p=webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!;await p.loadURL(origin+'/parent?observed')},origin)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`),{requestInit:{headers:{authorization:`Bearer ${profile.credential}`}}}))
    const resume=await client.callTool({name:'browser_workspaces',arguments:{action:'resume',workspaceId:workspace.id,resumeKey:workspace.resumeKey}}) as CallToolResult
    expect(resume.isError,text(resume)).not.toBe(true)
    const read=()=>client.callTool({name:'browser_snapshot',arguments:{workspaceId:workspace.id,tabId,frameSelector:'#chosen'}}) as Promise<CallToolResult>
    const first=await read();expect(first.isError,text(first)).not.toBe(true)
    expect((await client.callTool({name:'browser_evaluate',arguments:{workspaceId:workspace.id,tabId,script:'true'}})).isError).toBe(true)
    await electronApp.evaluate(({webContents},origin)=>{
      const p=webContents.getAllWebContents().find(p=>p.getURL().startsWith(origin+'/parent'))!,original=p.debugger.sendCommand.bind(p.debugger)
      let release!:()=>void;const wait=new Promise<void>(r=>{release=r})
      const gate:Gate={entered:false,releases:0,release,restore:()=>{p.debugger.sendCommand=original}}
      ;(globalThis as typeof globalThis&{__frameNativeGate?:Gate}).__frameNativeGate=gate
      p.debugger.sendCommand=async(method,params,session)=>{
        const result=await original(method,params,session)
        if(method==='Runtime.releaseObjectGroup'&&String(params?.objectGroup).startsWith('hronaut-frame-')&&!gate.entered){gate.entered=true;await wait}
        return result
      }
    },origin)
    const pending=read().then(r=>({rejected:r.isError===true,output:JSON.stringify(r)}),()=>({rejected:true,output:''}))
    await expect.poll(()=>electronApp.evaluate(()=>(globalThis as typeof globalThis&{__frameNativeGate:Gate}).__frameNativeGate.entered)).toBe(true)
    await appWindow.evaluate(id=>(window as unknown as {hronautSettings:HronautSettingsApi}).hronautSettings.revokeMcpCapabilityProfile(id),profile.profile.id)
    await electronApp.evaluate(()=>(globalThis as typeof globalThis&{__frameNativeGate:Gate}).__frameNativeGate.release())
    const result=await pending;expect(result.rejected).toBe(true);expect(result.output).not.toContain('Read grant child')
  }finally{
    await electronApp.evaluate(()=>{const m=globalThis as typeof globalThis&{__frameNativeGate?:Gate};m.__frameNativeGate?.release();m.__frameNativeGate?.restore();delete m.__frameNativeGate}).catch(()=>undefined)
    await client.close().catch(()=>undefined);await closeFixtureServer(server)
  }
})
