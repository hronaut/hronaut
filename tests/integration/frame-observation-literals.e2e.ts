import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { javascriptLiteral } from '../../src/shared/javascript-literal.js'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

for(const [name,marker] of [
  ['terminators-and-separators','</script><script>globalThis.__frameInjected=true</script>\u2028\u2029end'],
  ['quotes-and-backslashes','\");globalThis.__frameInjected=true;//\\']
])test(`frame selectors preserve literal data for ${name}`,async({capabilities,electronApp})=>{
  const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(q.url==='/parent'?'<iframe id="chosen" src="/child"></iframe>':'<h1>Literal child</h1>')})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`
  try{
    await capabilities.client.callTool({name:'browser_navigate',arguments:{tabId:capabilities.tabId,url:origin+'/parent'}})
    const script=`(()=>{const f=document.querySelector('#chosen');f.id=${javascriptLiteral(marker)};const selector='#'+CSS.escape(f.id);return {selector,beforeTrim:document.querySelector(selector)===f,afterTrim:document.querySelector(selector.trim())===f}})()`
    const selection=await electronApp.evaluate(async({webContents},{origin,script})=>webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!.executeJavaScript(script,false),{origin,script}) as {selector:string;beforeTrim:boolean;afterTrim:boolean}
    console.log('SELECTOR_NORMALIZATION_CONTROL',name,JSON.stringify({beforeTrim:selection.beforeTrim,afterTrim:selection.afterTrim}))
    expect(selection).toMatchObject({beforeTrim:true,afterTrim:true})
    const frameSelector=selection.selector
    const result=await capabilities.client.callTool({name:'browser_snapshot',arguments:{tabId:capabilities.tabId,frameSelector}}) as CallToolResult
    expect(result.isError,text(result)).not.toBe(true);expect(text(result)).toContain('h1: Literal child')
    expect(await electronApp.evaluate(async({webContents},origin)=>webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!.executeJavaScript('globalThis.__frameInjected===true',false),origin)).toBe(false)
  }finally{await closeFixtureServer(server)}
})
