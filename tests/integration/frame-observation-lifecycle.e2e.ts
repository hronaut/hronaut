import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

type MainGate = { entered: boolean; release(): void; restore(): void }
for (const change of ['child-reload','parent-navigation','remove-reinsert','parent-open','pause-roundtrip','workspace-access','debugger-loss']) {
  test(`frame response rejects ${change} during the outer audit await`, async ({capabilities,electronApp,appWindow})=>{
    const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(q.url?.startsWith('/parent')?'<iframe id="chosen" src="/child"></iframe>':'<h1>Captured child marker</h1>')})
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
    const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`
    let pending:Promise<unknown>|undefined
    try {
      await capabilities.client.callTool({name:'browser_navigate',arguments:{tabId:capabilities.tabId,url:origin+'/parent'}})
      const state=await appWindow.evaluate(()=> (window as unknown as {hronaut:HronautApi}).hronaut.getState())
      const workspaceId=state.tabs.find(t=>t.id===capabilities.tabId)!.mcpGroupId!
      const audit=await capabilities.client.callTool({name:'browser_audit_receipts',arguments:{action:'start'}}) as CallToolResult
      expect(audit.isError,text(audit)).not.toBe(true)
      await electronApp.evaluate(async({app})=>{
        const fs=process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises'),path=process.getBuiltinModule('node:path') as typeof import('node:path')
        const file=path.join(app.getPath('userData'),'frame-audit-prototype')
        const handle=await fs.open(file,'w'),prototype=Object.getPrototypeOf(handle) as {writeFile:(...args:unknown[])=>Promise<void>}
        await handle.close();await fs.unlink(file)
        const original=prototype.writeFile
        let release!:()=>void
        const held=new Promise<void>(r=>{release=r})
        const gate:MainGate={entered:false,release,restore:()=>{prototype.writeFile=original}}
        ;(globalThis as typeof globalThis&{__frameGate?:MainGate}).__frameGate=gate
        prototype.writeFile=async function(...args:unknown[]){
          await original.apply(this,args)
          if(!gate.entered&&String(args[0]).includes('"phase":"outcome"')){gate.entered=true;await held}
        }
      })
      pending=capabilities.client.callTool({name:'browser_snapshot',arguments:{tabId:capabilities.tabId,frameSelector:'#chosen'}})
      await expect.poll(()=>electronApp.evaluate(()=>(globalThis as typeof globalThis&{__frameGate:MainGate}).__frameGate.entered)).toBe(true)
      if(change==='pause-roundtrip') {
        await appWindow.evaluate('window.hronautMcp.setPaused(true)');await appWindow.evaluate('window.hronautMcp.setPaused(false)')
      }else if(change==='workspace-access'){
        await appWindow.evaluate(id=>(window as unknown as {hronaut:HronautApi}).hronaut.updateTabGroup(id,{agentAccess:false}),workspaceId)
        await appWindow.evaluate(id=>(window as unknown as {hronaut:HronautApi}).hronaut.updateTabGroup(id,{agentAccess:true}),workspaceId)
      }else await electronApp.evaluate(async({webContents},{origin,change})=>{
        const p=webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!
        if(change==='debugger-loss'){p.debugger.detach();return}
        if(change==='parent-navigation'){await p.loadURL(origin+'/parent?next');return}
        const code=change==='child-reload'?`new Promise(r=>{const f=document.querySelector('#chosen');f.onload=()=>r(true);f.contentWindow.location.reload()})`
          :change==='remove-reinsert'?`(()=>{const f=document.querySelector('#chosen');f.remove();document.body.append(f);return true})()`
          :`document.open();document.write('<h1>New parent</h1>');document.close();true`
        await p.executeJavaScript(code,false)
      },{origin,change})
      await electronApp.evaluate(()=>{const g=(globalThis as typeof globalThis&{__frameGate:MainGate}).__frameGate;g.release();g.restore()})
      const result=await pending as CallToolResult
      expect(result.isError,text(result)).toBe(true)
      expect(JSON.stringify(result)).not.toContain('Captured child marker')
      if(change==='parent-navigation'){const fresh=await capabilities.client.callTool({name:'browser_snapshot',arguments:{tabId:capabilities.tabId,frameSelector:'#chosen'}}) as CallToolResult;expect(fresh.isError,text(fresh)).not.toBe(true)}
    }finally{
      await electronApp.evaluate(()=>{const m=globalThis as typeof globalThis&{__frameGate?:MainGate};m.__frameGate?.release();m.__frameGate?.restore();delete m.__frameGate}).catch(()=>undefined)
      await pending?.catch(()=>undefined)
      await closeFixtureServer(server)
    }
  })
}

test('frame calls preserve workspace default and Follow selection and never wake sleeping targets',async({capabilities,appWindow,mcpPort,mcpToken})=>{
  const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(q.url?.startsWith('/parent')?'<iframe id="chosen" src="/child"></iframe>':'<h1>Child</h1>')})
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`
  try{
    await capabilities.client.callTool({name:'browser_navigate',arguments:{tabId:capabilities.tabId,url:origin+'/parentA'}})
    const created=await capabilities.client.callTool({name:'browser_new_tab',arguments:{url:origin+'/parentB'}}) as CallToolResult
    const b=(JSON.parse(text(created)) as BrowserState).activeTabId!
    // Complete the fixture's existing diagnostics setup before an explicitly
    // requested new navigation; the frame operation itself never does this.
    const ready=await capabilities.client.callTool({name:'browser_evaluate',arguments:{tabId:b,script:'true',dialogAction:'dismiss'}}) as CallToolResult
    expect(ready.isError,text(ready)).not.toBe(true)
    const navigated=await capabilities.client.callTool({name:'browser_navigate',arguments:{tabId:b,url:origin+'/parentB?observed=1'}}) as CallToolResult
    expect(navigated.isError,text(navigated)).not.toBe(true)
    await appWindow.evaluate(async id=>{const api=(window as unknown as {hronaut:HronautApi;hronautSettings:HronautSettingsApi});await api.hronaut.selectTab(id);await api.hronautSettings.setFollowAgentActivity(true)},capabilities.tabId)
    const state=()=>appWindow.evaluate(()=> (window as unknown as {hronaut:HronautApi}).hronaut.getState())
    const before=await state(),workspaceId=before.tabs.find(t=>t.id===b)!.mcpGroupId!
    const group=before.mcpTabGroups.find(g=>g.id===workspaceId)!
    const readiness=async()=>{
      const response=await fetch(`http://127.0.0.1:${mcpPort}/healthz`,{headers:{authorization:`Bearer ${mcpToken}`}})
      expect(response.ok).toBe(true)
      const state=await response.json() as {readiness:{checks:{probe:unknown}}}
      return state.readiness.checks.probe
    }
    const beforeReadiness=await readiness()
    for(const extra of [{},{rootSelector:'main'}]){
      const result=await capabilities.client.callTool({name:'browser_snapshot',arguments:{tabId:b,frameSelector:'#chosen',...extra}}) as CallToolResult
      expect(result.isError===true,text(result)).toBe('rootSelector' in extra)
      expect(await readiness()).toEqual(beforeReadiness)
      const after=await state();expect(after.activeTabId).toBe(before.activeTabId);expect(after.mcpTabGroups.find(g=>g.id===workspaceId)).toMatchObject({activeTabId:group.activeTabId,lastUsedAt:group.lastUsedAt})
    }
    await appWindow.evaluate(id=>(window as unknown as {hronaut:HronautApi}).hronaut.setTabSleeping(id,true),b)
    const asleep=await state()
    const denied=await capabilities.client.callTool({name:'browser_snapshot',arguments:{tabId:b,frameSelector:'#chosen'}}) as CallToolResult
    expect(denied.isError).toBe(true)
    const after=await state();expect(after.tabs.find(t=>t.id===b)?.sleeping).toBe(true);expect(after.activeTabId).toBe(asleep.activeTabId)
    expect(after.mcpTabGroups.find(g=>g.id===workspaceId)).toMatchObject({activeTabId:group.activeTabId,lastUsedAt:group.lastUsedAt})
    const implicit=await capabilities.client.callTool({name:'browser_evaluate',arguments:{script:'location.pathname'}}) as CallToolResult
    expect(text(implicit)).toContain('/parentA')
  }finally{await closeFixtureServer(server)}
})
