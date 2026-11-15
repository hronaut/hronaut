import { test, expect, text } from './capability-fixtures.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi, McpTabActivity } from '../../src/shared/types.js'
import { pageAt } from './fixtures.js'

type Witness = { values: string[]; other: string; events: { type: string; values: string[]; trusted: boolean }[] }
const html='<select id="choices" multiple><option value="a" selected>A label secret</option><optgroup label="Group"><option value="b">B</option><option value="x">X</option><option value="c">C</option></optgroup><option value="">Empty</option></select><input id="other" value="unrelated-secret">'
const setup=`document.body.innerHTML=${JSON.stringify(html)};window.selectionEvents=[];for(const type of ['input','change'])document.addEventListener(type,e=>{window.selectionEvents.push({type,values:Array.from(e.target.selectedOptions??[],o=>o.value),trusted:e.isTrusted})});void 0`
const witness=`({values:Array.from(document.querySelector('#choices').selectedOptions,o=>o.value),other:document.querySelector('#other').value,events:window.selectionEvents})`

test('semantic option sets replace, clear and preserve single-value compatibility', async ({ capabilities, electronApp }) => {
  const page=await pageAt(electronApp, capabilities.fixtureUrl)
  await page.evaluate(setup)
  for (const values of [['c','b'],[''],[]]) {
    await page.evaluate('window.selectionEvents=[]')
    const result=await capabilities.client.callTool({name:'browser_select',arguments:{tabId:capabilities.tabId,selector:'#choices',values}}) as CallToolResult
    expect(result.isError,text(result)).not.toBe(true)
    expect(JSON.parse(text(result))).toMatchObject({ok:true,semantic:true,selectedCount:values.length})
    expect(text(result)).not.toContain('label secret')
    expect(text(result)).not.toContain('unrelated-secret')
    const state=await page.evaluate<Witness>(witness)
    expect(state.values).toEqual([...values].sort())
    expect(state.other).toBe('unrelated-secret')
    expect(state.events.map((e:{type:string})=>e.type)).toEqual(['input','change'])
    expect(state.events.every((e:{values:string[];trusted:boolean})=>JSON.stringify(e.values)===JSON.stringify([...values].sort())&&!e.trusted)).toBe(true)
  }
  const single=await capabilities.client.callTool({name:'browser_select',arguments:{tabId:capabilities.tabId,selector:'#choices',value:'b'}}) as CallToolResult
  expect(single.isError,text(single)).not.toBe(true)
  expect((await page.evaluate<Witness>(witness)).values).toEqual(['b'])
})

const invalid = [
  ['missing', '', ['b','absent']], ['duplicate requested', '', ['b','b']],
  ['duplicate option', "document.querySelector('#choices').insertAdjacentHTML('beforeend','<option value=b>duplicate secret</option>')",['b']],
  ['disabled option', "document.querySelector('option[value=b]').disabled=true",['b']],
  ['disabled group', "document.querySelector('optgroup').disabled=true",['c']],
  ['disabled selected group clear', "document.querySelector('optgroup').prepend(document.querySelector('option[value=a]'));document.querySelector('optgroup').disabled=true",[]],
  ['second legend', "document.querySelector('#choices').outerHTML='<fieldset disabled><legend>first</legend><legend>'+document.querySelector('#choices').outerHTML+'</legend></fieldset>'",['b']],
  ['disabled selected clear', "document.querySelector('option[value=a]').disabled=true",[]],
  ['disabled control', "document.querySelector('#choices').disabled=true",['b']],
  ['disabled fieldset', "document.querySelector('#choices').outerHTML='<fieldset disabled>'+document.querySelector('#choices').outerHTML+'</fieldset>'",['b']],
  ['not multiple', "document.querySelector('#choices').multiple=false",['b']],
  ['hidden', "document.querySelector('#choices').style.display='none'",['b']],
  ['ambiguous target', "document.body.insertAdjacentHTML('beforeend',document.querySelector('#choices').outerHTML)",['b']],
  ['unrequested value cap', "document.querySelector('#choices').add(new Option('oversized secret','x'.repeat(1025)))",['b']],
  ['option cap', "for(let i=0;i<1001;i++)document.querySelector('#choices').add(new Option('extra','extra'+i))",['b']]
] as const
for(const [name,mutation,values] of invalid) test(`semantic option set rejects ${name} without partial selection`,async({capabilities,electronApp})=>{
  const page=await pageAt(electronApp, capabilities.fixtureUrl)
  await page.evaluate(setup);if(mutation)await page.evaluate(mutation+';void 0')
  const before=await page.evaluate<Witness>(witness)
  const result=await capabilities.client.callTool({name:'browser_select',arguments:{tabId:capabilities.tabId,selector:'#choices',values:[...values]}}) as CallToolResult
  expect(result.isError).toBe(true)
  if(name!=='duplicate requested')expect(JSON.parse(text(result))).toMatchObject({status:'REJECTED',effects:'none',retrySafe:false})
  expect(await page.evaluate<Witness>(witness)).toEqual(before)
  expect(text(result)).not.toContain('duplicate secret')
})

for(const change of ['revert','replace','options','disable','value-collision','change-event'] as const)test(`semantic option set reports ${change} handler uncertainty without replay`,async({capabilities,electronApp})=>{
  const page=await pageAt(electronApp, capabilities.fixtureUrl)
  await page.evaluate(setup)
  const mutation=change==='revert'?"e.target.options[0].selected=true":change==='replace'?"e.target.outerHTML='<select id=choices multiple><option value=replacement selected>replacement</option></select>'":change==='options'?"e.target.add(new Option('extra','extra'))":change==='value-collision'?"e.target.querySelector('option[value=c]').value='b'":change==='change-event'?"e.target.options[0].selected=true":"e.target.disabled=true"
  await page.evaluate(`document.querySelector('#choices').addEventListener('${change==='change-event'?'change':'input'}',e=>{${mutation}});void 0`)
  const result=await capabilities.client.callTool({name:'browser_select',arguments:{tabId:capabilities.tabId,selector:'#choices',values:['b','c']}}) as CallToolResult
  expect(result.isError).toBe(true)
  expect(JSON.parse(text(result))).toMatchObject({status:'OUTCOME_UNKNOWN',retrySafe:false})
  const state=await page.evaluate<Witness>(witness)
  expect(state.events.map((e:{type:string})=>e.type)).toEqual(change==='change-event'?['input','change']:['input'])
})

for(const change of ['pause','cancel','navigation','access','close'] as const)test(`semantic option set vetoes ${change} after preparation`,async({capabilities,electronApp,appWindow})=>{
  const {fixtureUrl,tabId,client}=capabilities
  const page=await pageAt(electronApp, fixtureUrl)
  await page.evaluate(setup)
  await electronApp.evaluate(({webContents},url)=>{
    const page=webContents.getAllWebContents().find(p=>p.getURL()===url)!,original=page.executeJavaScript,isolated=page.executeJavaScriptInIsolatedWorld
    let release!:()=>void;const barrier=new Promise<void>(r=>{release=r})
    const probe={ready:false,submissions:0,finished:false,release,restore:()=>{release();page.executeJavaScript=original;page.executeJavaScriptInIsolatedWorld=isolated}}
    page.executeJavaScriptInIsolatedWorld=async(world,...args)=>{if(world===1021)probe.submissions++;return isolated.call(page,world,...args)}
    ;(globalThis as typeof globalThis &{selectProbe?:typeof probe}).selectProbe=probe
    page.executeJavaScript=async(code,...args)=>{const result=await original.call(page,code,...args);if(code==='window.__hronautAgentInputActive = true'){probe.ready=true;await barrier}if(code==='delete window.__hronautAgentInputActive')probe.finished=true;return result}
  },fixtureUrl)
  const transport=client.transport!,originalSend=transport.send.bind(transport)
  let cancellationDelivered=false
  transport.send=async(message,options)=>{await originalSend(message,options);if('method' in message&&message.method==='notifications/cancelled')cancellationDelivered=true}
  await appWindow.evaluate(()=>{
    const state=window as unknown as {hronaut:HronautApi;semanticActivities:McpTabActivity[];stopSemanticActivity:()=>void}
    state.semanticActivities=[]
    state.stopSemanticActivity=state.hronaut.onMcpTabActivity(activity=>{if(activity.toolName==='browser_select')state.semanticActivities.push(activity)})
  })
  const abort=new AbortController()
  let pending:Promise<CallToolResult>|undefined
  try{
    pending=client.callTool({name:'browser_select',arguments:{tabId,selector:'#choices',values:['b']}},undefined,{signal:abort.signal}) as Promise<CallToolResult>
    if(change==='cancel')pending=pending.catch(()=>({isError:true,content:[]}))
    await expect.poll(()=>electronApp.evaluate(()=>(globalThis as typeof globalThis &{selectProbe:{ready:boolean}}).selectProbe.ready)).toBe(true)
    if(change==='close')await appWindow.evaluate(id=>(window as unknown as {hronaut:HronautApi}).hronaut.closeTab(id),tabId)
    if(change==='pause')await appWindow.evaluate(id=>(window as unknown as {hronaut:HronautApi}).hronaut.setTabAgentPaused(id,true),tabId)
    if(change==='cancel'){abort.abort();await expect.poll(()=>cancellationDelivered).toBe(true)}
    if(change==='access')await appWindow.evaluate(async id=>{const api=(window as unknown as {hronaut:HronautApi}).hronaut;const group=(await api.getState()).tabs.find(t=>t.id===id)!.mcpGroupId!;await api.updateTabGroup(group,{agentAccess:false})},tabId)
    if(change==='navigation')await electronApp.evaluate(async({webContents},url)=>{await webContents.getAllWebContents().find(p=>p.getURL()===url)!.loadURL('data:text/html,<select id=choices multiple><option value=b>new</option></select>')},fixtureUrl)
    await electronApp.evaluate(()=>(globalThis as typeof globalThis &{selectProbe:{release:()=>void}}).selectProbe.release())
    const result=await pending;expect(result.isError).toBe(true)
    if(change!=='cancel')expect(JSON.parse(text(result))).toMatchObject({status:'NOT_DISPATCHED',effects:'none',retrySafe:false})
    await expect.poll(()=>appWindow.evaluate(()=>(window as unknown as {semanticActivities:McpTabActivity[]}).semanticActivities.filter(a=>a.phase==='failed').at(-1)?.result)).toMatchObject({dispatch:'not-dispatched',effects:'none'})
    if(change!=='close')await expect.poll(()=>electronApp.evaluate(()=>(globalThis as typeof globalThis &{selectProbe:{finished:boolean}}).selectProbe.finished)).toBe(true)
    expect(await electronApp.evaluate(()=>(globalThis as typeof globalThis &{selectProbe:{submissions:number}}).selectProbe.submissions)).toBe(0)
    if(change==='navigation')expect(await page.evaluate("Array.from(document.querySelector('#choices').selectedOptions,o=>o.value)")).toEqual([])
    if(change!=='navigation'&&change!=='close'){const state=await page.evaluate<Witness>(witness);expect(state.values).toEqual(['a']);expect(state.events).toEqual([])}
  }finally{await appWindow.evaluate(()=>(window as unknown as {stopSemanticActivity:()=>void}).stopSemanticActivity());transport.send=originalSend;await electronApp.evaluate(()=>(globalThis as typeof globalThis &{selectProbe?:{restore:()=>void}}).selectProbe?.restore()).catch(()=>undefined)}
})

for (const variant of ['first-legend-ref','hostile-prototype'] as const) test(`semantic option set supports ${variant}`,async({capabilities,electronApp})=>{
  const page=await pageAt(electronApp, capabilities.fixtureUrl)
  await page.evaluate(setup)
  await page.evaluate(variant==='first-legend-ref'?"document.querySelector('#choices').outerHTML='<fieldset disabled><legend>'+document.querySelector('#choices').outerHTML+'</legend></fieldset>';document.querySelector('#choices').dataset.hronautRef='safe-ref'":"Object.defineProperty(HTMLOptionElement.prototype,'selected',{get(){throw Error('hostile getter')},set(){throw Error('hostile setter')}})")
  const result=await capabilities.client.callTool({name:'browser_select',arguments:{tabId:capabilities.tabId,...(variant==='first-legend-ref'?{ref:'safe-ref'}:{selector:'#choices'}),values:['b','c']}}) as CallToolResult
  expect(result.isError,text(result)).not.toBe(true)
  expect(JSON.parse(text(result))).toMatchObject({status:'SELECTED',selectedCount:2})
})

for (const boundary of ['neither','both','nonselect','shadow','frame'] as const) test(`semantic option set refuses ${boundary} target contract`,async({capabilities,electronApp})=>{
  const page=await pageAt(electronApp, capabilities.fixtureUrl)
  await page.evaluate(setup)
  if(boundary==='nonselect')await page.evaluate("document.querySelector('#choices').outerHTML='<div id=choices role=listbox>Custom</div>'")
  if(boundary==='shadow')await page.evaluate("const select=document.querySelector('#choices');const host=document.createElement('div');document.body.append(host);host.attachShadow({mode:'open'}).append(select);void 0")
  if(boundary==='frame')await page.evaluate("const frame=document.createElement('iframe');document.body.append(frame);frame.contentDocument.body.append(document.querySelector('#choices'));void 0")
  const args=boundary==='neither'?{}:boundary==='both'?{value:'b',values:['b']}:{values:['b']}
  const result=await capabilities.client.callTool({name:'browser_select',arguments:{tabId:capabilities.tabId,selector:'#choices',...args}}) as CallToolResult
  expect(result.isError).toBe(true)
  expect(await page.evaluate('window.selectionEvents')).toEqual([])
})

for (const disabled of [true,false]) for (const clear of [false,true]) test(`semantic wrapped optgroup disabled=${disabled} clear=${clear}`,async({capabilities,electronApp})=>{
  const page=await pageAt(electronApp, capabilities.fixtureUrl)
  await page.evaluate(setup)
  const before=await page.evaluate(({disabled,clear})=>{
    const group=document.querySelector('optgroup')!,wrapper=document.createElement('div')
    wrapper.append(...group.children);group.append(wrapper);group.disabled=disabled
    const option=document.querySelector<HTMLOptionElement>('option[value=b]')!
    if(clear){document.querySelector<HTMLOptionElement>('option[value=a]')!.selected=false;option.selected=true}
    return {nativeDisabled:option.matches(':disabled'),ownDisabled:option.disabled,parent:option.parentElement!.localName,values:Array.from(document.querySelector<HTMLSelectElement>('#choices')!.selectedOptions,o=>o.value)}
  },{disabled,clear})
  expect(before).toMatchObject({nativeDisabled:disabled,ownDisabled:false,parent:'div',values:clear?['b']:['a']})
  // Main-world attempts to spoof native disabledness cannot change isolated-world admission.
  await page.evaluate("Element.prototype.matches=function(){return false};void 0")
  const result=await capabilities.client.callTool({name:'browser_select',arguments:{tabId:capabilities.tabId,selector:'#choices',values:clear?[]:['b','c']}}) as CallToolResult
  const state=await page.evaluate<Witness>(witness)
  if(disabled){
    expect(result.isError).toBe(true)
    expect(JSON.parse(text(result))).toMatchObject({status:'REJECTED',effects:'none',retrySafe:false})
    expect(state.values).toEqual(before.values);expect(state.events).toEqual([])
  }else{
    expect(result.isError,text(result)).not.toBe(true)
    expect(state.values).toEqual(clear?[]:['b','c'])
    expect(state.events.map(e=>e.type)).toEqual(['input','change'])
  }
})

test('semantic wrapped optgroup disabled by input handler invalidates readback',async({capabilities,electronApp})=>{
  const page=await pageAt(electronApp, capabilities.fixtureUrl)
  await page.evaluate(setup)
  await page.evaluate("const group=document.querySelector('optgroup'),wrapper=document.createElement('div');wrapper.append(...group.children);group.append(wrapper);document.querySelector('#choices').addEventListener('input',()=>{group.disabled=true});void 0")
  const result=await capabilities.client.callTool({name:'browser_select',arguments:{tabId:capabilities.tabId,selector:'#choices',values:['b','c']}}) as CallToolResult
  expect(result.isError).toBe(true)
  expect(JSON.parse(text(result))).toMatchObject({status:'OUTCOME_UNKNOWN',effects:'possible',retrySafe:false})
  expect((await page.evaluate<Witness>(witness)).events.map(e=>e.type)).toEqual(['input'])
})
