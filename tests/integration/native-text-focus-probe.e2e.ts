// Private protocol experiment only. No public tool or production adapter is added.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './capability-fixtures.js'
import type { HronautApi } from '../../src/shared/types.js'

type Probe = { attachedByProbe: boolean; pageId: number; navigated: boolean; dispatches: number; acknowledged: boolean; listener: () => void }
type Scope = typeof globalThis & { textProbe?: Probe }
const cases = ['control', 'controlled-editor', 'cancel-beforeinput', 'focus-before-check', 'selection-before-check', 'replace-before-check', 'navigation-before-check', 'navigation-before-dispatch', 'pause-before-dispatch', 'cancel-before-dispatch', 'microtask-focus', 'microtask-selection', 'microtask-replace', 'pause-after-ack', 'cancel-after-ack'] as const
for (const scenario of cases) test(`private native text: ${scenario}`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
  const { tabId, fixtureUrl } = capabilities
  const abort = new AbortController()
  const rich = scenario === 'controlled-editor'
  const setup = `document.body.innerHTML=${JSON.stringify('<textarea id="a">abcd</textarea><textarea id="b">WXYZ</textarea><div id="rich" contenteditable="true">abcd</div>')};window.textEffects={events:[],model:'abcd'};window.admitted=document.getElementById(${JSON.stringify(rich ? 'rich' : 'a')});window.admitted.focus();${rich ? "const range=document.createRange();range.setStart(window.admitted.firstChild,1);range.setEnd(window.admitted.firstChild,3);getSelection().removeAllRanges();getSelection().addRange(range);" : 'window.admitted.setSelectionRange(1,3);'}for(const type of ['beforeinput','input','keydown','keyup'])document.addEventListener(type,e=>{window.textEffects.events.push({type,id:e.target.id,trusted:e.isTrusted,inputType:e.inputType??null,data:e.data??null});${scenario === 'cancel-beforeinput' ? "if(type==='beforeinput')e.preventDefault();" : ''}if(type==='input'&&e.target.id==='rich')window.textEffects.model=e.target.textContent;});void 0`
  await electronApp.evaluate(async ({ webContents }, { url, setup }) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
    const attachedByProbe = !page.debugger.isAttached()
    await page.executeJavaScript(setup)
    page.focus()
    const probe: Probe = { attachedByProbe, pageId: page.id, navigated: false, dispatches: 0, acknowledged: false, listener: () => { probe.navigated = true } }
    page.on('did-navigate', probe.listener)
    if (attachedByProbe) page.debugger.attach('1.3')
    ;(globalThis as Scope).textProbe = probe
  }, { url: fixtureUrl, setup })
  let validation: unknown
  try {
    const mutate = scenario === 'focus-before-check' ? "document.querySelector('#b').focus()"
      : scenario === 'selection-before-check' ? 'window.admitted.setSelectionRange(4,4)'
        : scenario === 'replace-before-check' ? "window.admitted.outerHTML='<textarea id=a>replaced</textarea>';document.querySelector('#a').focus()" : ''
    if (mutate) await electronApp.evaluate(async ({ webContents }, script) => {
      await webContents.fromId((globalThis as Scope).textProbe!.pageId)!.executeJavaScript(script + ';void 0')
    }, mutate)
    if (scenario === 'navigation-before-check') await electronApp.evaluate(async ({ webContents }) => {
      await webContents.fromId((globalThis as Scope).textProbe!.pageId)!.loadURL('data:text/html,<textarea id="replacement" autofocus>replacement</textarea>')
    })
    const racedMutation = scenario === 'microtask-focus' ? "document.querySelector('#b').focus();document.querySelector('#b').setSelectionRange(2,2)"
      : scenario === 'microtask-selection' ? 'window.admitted.setSelectionRange(4,4)'
        : scenario === 'microtask-replace' ? "window.admitted.outerHTML='<textarea id=a>replaced</textarea>';document.querySelector('#a').focus();document.querySelector('#a').setSelectionRange(0,0)" : ''
    const immediate = !['pause-before-dispatch','cancel-before-dispatch','navigation-before-dispatch'].includes(scenario)
    validation = await electronApp.evaluate(async ({ webContents }, { racedMutation, rich, immediate }) => {
      const p = (globalThis as Scope).textProbe!, page = webContents.fromId(p.pageId)!
      if (p.navigated) return { admitted: false, reason: 'navigation-veto' }
      // Renderer observation is atomic inside this evaluation; the queued mutation
      // executes after that observation, before its reply reaches the main process.
      const checked = await page.executeJavaScript(`(() => {const a=window.admitted;const selected=${rich ? "getSelection().toString()==='bc'" : 'a?.selectionStart===1&&a?.selectionEnd===3'};const ok=!!a&&a.isConnected&&document.activeElement===a&&selected;if(ok&&${JSON.stringify(racedMutation)}.length)queueMicrotask(()=>{${racedMutation}});return {ok,focus:document.activeElement?.id,selected};})()`)
      if (!checked.ok || p.navigated) return { admitted: false, reason: 'target-veto', checked }
      if (immediate) {
        // No main-process await/barrier after the renderer reply and before input.
        p.dispatches++
        await page.debugger.sendCommand('Input.insertText', { text: 'Q漢😀' })
        p.acknowledged = true
      }
      return { admitted: true, checked, immediate }
    }, { racedMutation, rich, immediate })
    // Explicit parent-side barrier after the final renderer reply. These changes
    // are real fixture actions; final diagnostic guards must veto before CDP.
    if (scenario === 'pause-before-dispatch') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), tabId)
    if (scenario === 'cancel-before-dispatch') abort.abort()
    if (scenario === 'navigation-before-dispatch') await electronApp.evaluate(async ({ webContents }) => {
      await webContents.fromId((globalThis as Scope).textProbe!.pageId)!.loadURL('data:text/html,<textarea id="replacement" autofocus>replacement</textarea>')
    })
    const paused = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id)!.agentPaused === true, tabId)
    const authorized = !paused && !abort.signal.aborted
    const checkedValidation = validation
    validation = await electronApp.evaluate(async ({ webContents }, { authorized, validation }) => {
      const p=(globalThis as Scope).textProbe!,page=webContents.fromId(p.pageId)!
      if (p.acknowledged) return validation
      if (!authorized || p.navigated || !validation.admitted) return { admitted:false, reason:!authorized?'authority-veto':p.navigated?'navigation-veto':'target-veto',checked:validation }
      p.dispatches++
      await page.debugger.sendCommand('Input.insertText', {text:'Q漢😀'})
      p.acknowledged=true
      return validation
    }, {authorized,validation:validation as {admitted:boolean}})
    const admitted = (validation as { admitted: boolean }).admitted
    if (scenario === 'pause-after-ack') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), tabId)
    if (scenario === 'cancel-after-ack') abort.abort()
    const result = !admitted ? 'diagnostic-pre-dispatch-veto' : scenario.endsWith('after-ack') ? 'diagnostic-unknown-no-replay' : 'protocol-ack-only'
    const observed = await electronApp.evaluate(async ({ webContents }) => {
      const p=(globalThis as Scope).textProbe!,page=webContents.fromId(p.pageId)!
      return { dispatches:p.dispatches,acknowledged:p.acknowledged,navigated:p.navigated,runtime:process.versions,effects:await page.executeJavaScript(`({a:document.querySelector('#a')?.value??null,b:document.querySelector('#b')?.value??null,rich:document.querySelector('#rich')?.textContent??null,focus:document.activeElement?.id,admittedConnected:window.admitted?.isConnected??false,activeIsAdmitted:document.activeElement===window.admitted,events:window.textEffects?.events??[],model:window.textEffects?.model??null})`) }
    })
    const receipt={scenario,result,checkedValidation,validation,...observed,automaticReplay:false,publicApi:false,authorityGuard:'private diagnostic reads actual tab pause and local AbortSignal; not a production MCP insertion policy'}
    await writeFile(process.env.HRONAUT_TEXT_PROBE_OUTPUT ? join(process.env.HRONAUT_TEXT_PROBE_OUTPUT, `${scenario}.json`) : testInfo.outputPath('receipt.json'),JSON.stringify(receipt,null,2)+'\n')
    const expectedVeto = ['focus-before-check','selection-before-check','replace-before-check','navigation-before-check','navigation-before-dispatch','pause-before-dispatch','cancel-before-dispatch'].includes(scenario)
    expect(admitted).toBe(!expectedVeto)
    if (!admitted) { expect(observed.dispatches).toBe(0); expect(observed.effects.events).toHaveLength(0) }
    else {
      expect(observed.dispatches).toBe(1)
      expect(observed.effects.events.map((e:{type:string})=>e.type)).toEqual(scenario==='cancel-beforeinput'?['beforeinput']:['beforeinput','input'])
      expect(observed.effects.events.every((e: { trusted: boolean })=>e.trusted)).toBe(true)
      expect(observed.effects.events.some((e: { type: string })=>e.type==='keydown'||e.type==='keyup')).toBe(false)
      if (scenario === 'microtask-focus') { expect(observed.effects.a).toBe('abcd');expect(observed.effects.b).toBe('WXQ漢😀YZ') }
      else if (scenario === 'microtask-selection') expect(observed.effects.a).toBe('abcdQ漢😀')
      else if (scenario === 'microtask-replace') { expect(observed.effects.a).toBe('Q漢😀replaced');expect(observed.effects.admittedConnected).toBe(false);expect(observed.effects.activeIsAdmitted).toBe(false) }
      else if (scenario === 'cancel-beforeinput') expect(observed.effects.a).toBe('abcd')
      else if (rich) { expect(observed.effects.rich).toBe('aQ漢😀d');expect(observed.effects.model).toBe('aQ漢😀d') }
      else expect(observed.effects.a).toBe('aQ漢😀d')
    }
  } finally {
    await electronApp.evaluate(({ webContents }) => {
      const p=(globalThis as Scope).textProbe;if(!p)return;const page=webContents.fromId(p.pageId);if(page&&!page.isDestroyed()){page.removeListener('did-navigate',p.listener);if(p.attachedByProbe&&page.debugger.isAttached())page.debugger.detach()}delete(globalThis as Scope).textProbe
    }).catch(()=>undefined)
  }
})
