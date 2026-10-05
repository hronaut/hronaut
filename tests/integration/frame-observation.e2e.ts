import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createServer } from 'node:http'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

test('frame observation reads only chosen same-origin child without parent refs or context changes', async ({ capabilities, electronApp }) => {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(request.url === '/parent'
      ? '<button id="parent">Parent only</button><iframe id="chosen" src="/child"></iframe><iframe src="/sibling"></iframe>'
      : request.url === '/child'
        ? '<h1>Chosen preview</h1><p>Child public text</p><input value="PRIVATE INPUT"><div contenteditable="true">PRIVATE EDITOR</div><iframe src="/nested"></iframe>'
        : '<h1>Other frame only</h1>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const nav = await capabilities.client.callTool({ name: 'browser_navigate', arguments: { tabId: capabilities.tabId, url: origin + '/parent' } })
    expect(nav.isError, text(nav as CallToolResult)).not.toBe(true)
    const before = await electronApp.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === origin + '/parent')!
      return page.executeJavaScript(`(()=>{document.querySelector('#parent').setAttribute('data-hronaut-ref','e77');document.querySelector('#parent').focus();return {focus:document.activeElement.id,scroll:scrollY,refs:document.querySelectorAll('[data-hronaut-ref]').length}})()`, false)
    }, origin)
    const result = await capabilities.client.callTool({ name: 'browser_snapshot', arguments: { tabId: capabilities.tabId, action: 'capture', frameSelector: '#chosen' } })
    expect(result.isError, text(result as CallToolResult)).not.toBe(true)
    expect(result.structuredContent).toMatchObject({ kind: 'frame-observation', formatVersion: 1 })
    const output = JSON.stringify(result)
    expect(output).toContain('Chosen preview')
    expect(output).not.toContain('Parent only')
    expect(output).not.toContain('Other frame only')
    expect(output).not.toContain('PRIVATE INPUT')
    expect(output).not.toContain('PRIVATE EDITOR')
    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(32768)
    const after = await electronApp.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === origin + '/parent')!
      return page.executeJavaScript(`({focus:document.activeElement.id,scroll:scrollY,refs:document.querySelectorAll('[data-hronaut-ref]').length,ref:document.querySelector('#parent').getAttribute('data-hronaut-ref')})`, false)
    }, origin)
    expect(after).toEqual({ ...(before as object), ref: 'e77' })
  } finally { await closeFixtureServer(server) }
})

for (const variant of ['opaque-csp','sandbox','srcdoc','domain-relaxed','document-open','clipping','legacy-clip','paint-containment','parent-mask','hidden','missing','ambiguous','not-frame','malformed']) {
  test(`frame observation handles ${variant} conservatively through MCP`, async ({capabilities,electronApp})=>{
    let alternateOrigin=''
    const alternate=createServer((_q,r)=>{r.setHeader('Content-Type','text/html');r.setHeader('Origin-Agent-Cluster','?0');r.end('<h1>FOREIGN SECRET</h1><script>document.domain="localhost"</script>')})
    await new Promise<void>(r=>alternate.listen(0,'127.0.0.1',r));alternateOrigin=`http://localhost:${(alternate.address() as {port:number}).port}`
    const server=createServer((q,r)=>{
      r.setHeader('Content-Type','text/html');r.setHeader('Origin-Agent-Cluster','?0')
      if(q.url==='/parent')r.end(`<button id="button">Parent</button>${variant==='domain-relaxed'?"<script>document.domain='localhost'</script>":''}<iframe id="chosen" ${variant==='sandbox'?'sandbox="allow-scripts"':''} ${variant==='srcdoc'?'srcdoc="<h1>SRCDOC SECRET</h1>"':''} ${variant==='parent-mask'?'style="mask-image:linear-gradient(transparent,transparent)"':variant==='hidden'?'style="display:none"':''} src="${variant==='domain-relaxed'?alternateOrigin:'/child'}"></iframe>${variant==='ambiguous'?'<iframe id="chosen" src="/child"></iframe>':''}`)
      else {if(variant==='opaque-csp')r.setHeader('Content-Security-Policy','sandbox allow-scripts');r.end(variant==='paint-containment'?'<div style="width:1px;height:1px;contain:paint">CLIPPED SECRET</div>':variant==='legacy-clip'?'<div style="position:absolute;clip:rect(0px,1px,1px,0px)">CLIPPED SECRET</div>':variant==='clipping'?'<div style="height:12px;overflow:hidden"><span>VISIBLE prefix<br>CLIPPED SECRET</span></div>':'<h1>Child content</h1>')}
    })
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
    const origin=`http://localhost:${(server.address() as {port:number}).port}`
    try {
      await capabilities.client.callTool({name:'browser_navigate',arguments:{tabId:capabilities.tabId,url:origin+'/parent'}})
      if(variant==='domain-relaxed')expect(await electronApp.evaluate(async({webContents},origin)=>webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!.executeJavaScript(`!!document.querySelector('#chosen').contentDocument`,false),origin)).toBe(true)
      if(variant==='document-open')await electronApp.evaluate(async({webContents},origin)=>{const p=webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!;await p.executeJavaScript(`(()=>{const d=document.querySelector('#chosen').contentDocument;d.open();d.write('<h1>REPLACEMENT SECRET</h1>');d.close()})()`,false)},origin)
      const frameSelector=variant==='missing'?'#absent':variant==='not-frame'?'#button':variant==='malformed'?'[':'#chosen'
      const result=await capabilities.client.callTool({name:'browser_snapshot',arguments:{tabId:capabilities.tabId,frameSelector}})
      if(variant==='clipping'||variant==='legacy-clip'||variant==='paint-containment') {expect(result.isError,text(result as CallToolResult)).not.toBe(true);expect(JSON.stringify(result)).not.toContain('CLIPPED SECRET');expect(JSON.stringify(result)).toContain(variant==='clipping'?'offscreen-or-clipped':'uncertain-layout')}
      else {expect(result.isError,variant+': '+text(result as CallToolResult)).toBe(true);expect(JSON.stringify(result)).not.toMatch(/FOREIGN SECRET|SRCDOC SECRET|REPLACEMENT SECRET/)}
    }finally{await closeFixtureServer(server);await closeFixtureServer(alternate)}
  })
}
