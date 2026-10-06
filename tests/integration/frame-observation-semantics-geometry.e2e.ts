import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

for (const variant of ['authored-semantics','heading-cap','control-cap','label-cap','padding-visible','horizontal-clip','vertical-clip','fractional-clip','scrolled-clip','child-scale','child-translate','ancestor-rotate']) {
  test(`frame semantic and geometry boundary: ${variant}`,async({capabilities,electronApp})=>{
    const fixtures:Record<string,string>={
      'authored-semantics':'<h2>Preview heading</h2><button aria-label="ARIA label"></button><button title="TITLE label"></button><button>Text label</button><label for="field">Associated label</label><input id="field" value="PRIVATE_VALUE" placeholder="PRIVATE_PLACEHOLDER"><span id="named">Referenced label</span><input aria-labelledby="named" value="PRIVATE_NAMED_VALUE"><fieldset disabled><input type="checkbox" aria-label="Checked label" checked></fieldset><div style="width:20px;height:20px" role="checkbox" aria-label="Mixed label" aria-checked="mixed" aria-disabled="true"></div><textarea aria-label="Textarea label" placeholder="PRIVATE_AREA_PLACEHOLDER">PRIVATE_AREA_VALUE</textarea><select aria-label="Select label"><option selected>PRIVATE_OPTION</option></select><div contenteditable="true"><button aria-label="PRIVATE_EDITOR_LABEL">PRIVATE_EDITOR_TEXT</button></div><a href="https://u:PRIVATE_PASSWORD@example.test/path?token=PRIVATE_TOKEN#PRIVATE_HASH">Public link</a>',
      'heading-cap':'<style>h2{display:inline-block;margin:0;font:1px monospace;width:2px;height:2px}</style>'+'<h2 aria-label="H"></h2>'.repeat(81),
      'control-cap':'<style>button{padding:0;border:0;width:1px;height:1px;display:inline-block}</style>'+'<button></button>'.repeat(501),
      'label-cap':'<button aria-label="'+'L'.repeat(350)+'"></button>',
      'padding-visible':'<div style="border:20px solid black;padding:15px;overflow:hidden;width:200px;height:50px">VISIBLE_PADDING</div>',
      'horizontal-clip':'<div style="position:relative;width:10px;height:50px;border:30px solid black;overflow-x:hidden;overflow-y:visible"><span style="position:absolute;left:20px;top:0;font:10px monospace">SECRET</span></div>',
      'vertical-clip':'<div style="position:relative;width:100px;height:10px;border:30px solid black;overflow-y:hidden;overflow-x:visible"><span style="position:absolute;left:0;top:20px;font:10px monospace">SECRET</span></div>',
      'fractional-clip':'<div style="width:100.5px;overflow:hidden">UNCERTAIN</div>',
      'scrolled-clip':'<div id="scroll" style="height:40px;overflow:auto"><p>HIDDEN_BEFORE</p><div style="height:90px"></div><p style="margin:0">VISIBLE_AFTER</p></div>',
      'child-scale':'<p style="scale:-1 1;backface-visibility:hidden">UNCERTAIN</p>',
      'child-translate':'<p style="translate:0px">UNCERTAIN</p>',
      'ancestor-rotate':'<p>UNCERTAIN</p>'
    }
    const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(q.url==='/parent'?`<div ${variant==='ancestor-rotate'?'style="rotate:y 180deg;backface-visibility:hidden"':''}><iframe id="chosen" src="/child" style="width:900px;height:400px"></iframe></div>`:'<body style="margin:8px">'+fixtures[variant]+'</body>')})
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`
    try{
      const nav=await capabilities.client.callTool({name:'browser_navigate',arguments:{tabId:capabilities.tabId,url:origin+'/parent'}}) as CallToolResult
      expect(nav.isError,text(nav)).not.toBe(true)
      if(variant==='scrolled-clip')await electronApp.evaluate(async({webContents},origin)=>webContents.getAllWebContents().find(p=>p.getURL()===origin+'/parent')!.executeJavaScript("document.querySelector('#chosen').contentDocument.querySelector('#scroll').scrollTop=999;true",false),origin)
      const result=await capabilities.client.callTool({name:'browser_snapshot',arguments:{tabId:capabilities.tabId,frameSelector:'#chosen',maxChars:16000}}) as CallToolResult
      if(variant==='ancestor-rotate'){expect(result.isError,text(result)).toBe(true);return}
      expect(result.isError,text(result)).not.toBe(true)
      const snapshot=result.structuredContent as {text:string;completeness:{omissions:string[]}}
      const output=snapshot.text
      if(variant==='authored-semantics'){
        for(const label of ['h2: Preview heading','button "ARIA label"','button "TITLE label"','button "Text label"','input "Associated label"','input "Referenced label"','input "Checked label" disabled checked=true','checkbox "Mixed label" disabled checked=mixed','textarea "Textarea label"','select "Select label"','example.test/path'])expect(output).toContain(label)
        expect(output).not.toContain('PRIVATE_');expect(output).not.toMatch(/\[e\d+\]/)
      }else if(variant.endsWith('-cap')){
        expect(snapshot.completeness.omissions).toContain('semantic-limit')
        if(variant==='heading-cap')expect(output.split('\n').filter(l=>l.startsWith('h2:'))).toHaveLength(80)
        if(variant==='control-cap')expect(output.split('\n').filter(l=>l.startsWith('button '))).toHaveLength(500)
        if(variant==='label-cap')expect(output).not.toContain('L'.repeat(301))
      }else if(variant==='padding-visible')expect(output).toContain('VISIBLE_PADDING')
      else if(variant==='scrolled-clip'){expect(output).toContain('VISIBLE_AFTER');expect(output).not.toContain('HIDDEN_BEFORE');expect(snapshot.completeness.omissions).toContain('offscreen-or-clipped')}
      else if(variant==='horizontal-clip'||variant==='vertical-clip'){expect(output).not.toContain('SECRET');expect(snapshot.completeness.omissions).toContain('offscreen-or-clipped')}
      else {expect(output).not.toContain('UNCERTAIN');expect(snapshot.completeness.omissions).toContain('uncertain-layout')}
    }finally{await closeFixtureServer(server)}
  })
}
