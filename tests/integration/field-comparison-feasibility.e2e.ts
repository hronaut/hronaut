import { comparisonScript, comparisonSettlementScript, FIELD_COMPARISON_WORLD_ID } from '../helpers/field-comparison-prototype.js'
import { expect, test } from './fixtures.js'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const actual = 'ACTUAL_PRIVATE_é😀\n第二行'
const expected = 'EXPECTED_PRIVATE_é😀'

test('reduces exact native values without page getters, form events or presentation mutations', async ({ electronApp }) => {
  const cases = [
    { value: '', expected: '', status: 'matched' },
    { value: ' ', expected: '', status: 'mismatched' },
    { value: actual, expected: actual, status: 'matched' },
    { value: actual, expected, status: 'mismatched' },
    { value: 'é', expected: 'e\u0301', status: 'mismatched' },
    { value: 'a\r\nb', expected: 'a\nb', status: 'matched' },
    { value: 'x'.repeat(4096), expected: 'x'.repeat(4096), status: 'matched' },
    { value: 'x'.repeat(4097), expected: 'x'.repeat(4096), status: 'unavailable' }
  ]
  const proof = await electronApp.evaluate(async ({ BrowserWindow }, input) => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'comparison-native-proof' } })
    const page = window.webContents
    try {
      await page.loadURL('data:text/html,' + encodeURIComponent(`<!doctype html><style>body{height:2000px}</style><input id="anchor" value="anchor"><textarea id="target">Default</textarea><script>
        globalThis.calls=0;globalThis.events=0;
        globalThis.write=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
        globalThis.read=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').get;
        Object.defineProperty(HTMLTextAreaElement.prototype,'value',{get(){calls++;throw Error('ACTUAL_PRIVATE_GETTER')},configurable:true});
        Object.defineProperty(target,'value',{get(){calls++;throw Error('ACTUAL_PRIVATE_OWN')},configurable:true});
        HTMLElement.prototype.attachInternals=()=>{calls++;throw Error('ACTUAL_PRIVATE_METHOD')};
        anchor.focus();anchor.setSelectionRange(1,3);scrollTo(0,100);
        for(const type of ['input','change','invalid','focus','blur'])document.addEventListener(type,()=>events++,true);
        globalThis.presentation=()=>({active:document.activeElement.id,start:anchor.selectionStart,end:anchor.selectionEnd,x:scrollX,y:scrollY,calls,events});
      </script>`))
      const rows = []
      for (const item of input.cases) {
        await page.executeJavaScript(`write.call(target,${JSON.stringify(item.value)})`, false)
        const before = await page.executeJavaScript('presentation()', false)
        const report = await page.executeJavaScriptInIsolatedWorld(input.world, [{ code: item.script }], false)
        const settled = await page.executeJavaScriptInIsolatedWorld(input.world, [{ code: input.settle }], false)
        const after = await page.executeJavaScript('presentation()', false)
        const unchanged = await page.executeJavaScript(`read.call(target)===${JSON.stringify(item.value.replace(/\r\n?/g, '\n'))}`, false)
        rows.push({ report, settled, before, after, unchanged })
      }
      return { rows, visible: window.isVisible(), focused: window.isFocused() }
    } finally { window.destroy() }
  }, { world: FIELD_COMPARISON_WORLD_ID, settle: comparisonSettlementScript('proof'), cases: cases.map(item => ({ value: item.value, script: comparisonScript('#target', item.expected, 'proof') })) })
  for (const [index, row] of proof.rows.entries()) {
    expect(row.report.status).toBe(cases[index]!.status)
    expect(row.settled).toBe(true)
    expect(row.after).toEqual(row.before)
    expect(row.after).toMatchObject({ calls: 0, events: 0, start: 1, end: 3 })
    expect(row.unchanged).toBe(true)
    expect(Object.keys(row.report).sort()).toEqual(row.report.status === 'unavailable' ? ['observedAt', 'reason', 'status'] : ['observedAt', 'status'])
  }
  expect(proof.visible).toBe(false)
  expect(proof.focused).toBe(false)
  expect(JSON.stringify(proof)).not.toMatch(/ACTUAL_PRIVATE|EXPECTED_PRIVATE|第二行|é/)
})

for (const tag of ['input', 'textarea'] as const) {
  test(`excludes sensitive and customized ${tag} controls and detects target ABA`, async ({ electronApp }) => {
    const selectors = ['#plain', '#disabled', '#readonly', '#otp', '#payment', '#hidden', '#custom', '#removed', '#programmatic', '#constructed', '#unregistered', '#editable', '#frame', '#shadow', '#password', '#file', '#email', '#missing', '[']
    const proof = await electronApp.evaluate(async ({ BrowserWindow }, input) => {
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'comparison-exclusion-proof' } })
      const page = window.webContents
      try {
        await page.loadURL('data:text/html,' + encodeURIComponent(`<!doctype html><script>
          const tag=${JSON.stringify(input.tag)},Base=tag==='input'?HTMLInputElement:HTMLTextAreaElement;
          globalThis.authorCalls=0;
          class Custom extends Base {get value(){authorCalls++;throw Error('ACTUAL_PRIVATE_CUSTOM')}}
          customElements.define('comparison-custom',Custom,{extends:tag});
          document.write(['plain','disabled','readonly','otp','payment','hidden','editable'].map(id=>'<'+tag+' id='+id+'></'+tag+'>').join(''));
        </script><script>
          disabled.disabled=true;readonly.readOnly=true;otp.autocomplete='one-time-code';payment.autocomplete='cc-number';hidden.hidden=true;editable.contentEditable='true';
          for(const id of ['custom','removed']){const n=document.createElement(tag,{is:'comparison-custom'});n.id=id;n.setAttribute('is','comparison-custom');document.body.append(n);if(id==='removed')n.removeAttribute('is')}
          for(const [id,n] of [['programmatic',document.createElement(tag,{is:'comparison-custom'})],['constructed',new Custom()],['unregistered',document.createElement(tag,{is:'unknown-control'})]]){n.id=id;document.body.append(n)}
          for(const type of ['password','file','email']){const n=document.createElement('input');n.id=type;n.type=type;document.body.append(n)}
          const frame=document.createElement('iframe');frame.id='frame';document.body.append(frame);const host=document.createElement('div');host.attachShadow({mode:'open'}).innerHTML='<input id=shadow>';document.body.append(host);
        </script>`))
        const rows = []
        for (const item of input.scripts) {
          const report = await page.executeJavaScriptInIsolatedWorld(input.world, [{ code: item.read }], false)
          await page.executeJavaScriptInIsolatedWorld(input.world, [{ code: input.cancel }], false)
          rows.push({ selector: item.selector, report })
        }
        const transitions = []
        for (const mutation of ["plain.setAttribute('autocomplete','one-time-code');plain.removeAttribute('autocomplete')", "const old=plain;old.remove();document.body.append(old)", "plain.replaceWith(plain.cloneNode())"]) {
          const report = await page.executeJavaScriptInIsolatedWorld(input.world, [{ code: input.read }], false)
          await page.executeJavaScript(mutation, false)
          const settled = await page.executeJavaScriptInIsolatedWorld(input.world, [{ code: input.settle }], false)
          transitions.push({ report, settled })
        }
        return { rows, transitions, authorCalls: await page.executeJavaScript('authorCalls', false) }
      } finally { window.destroy() }
    }, { tag, world: FIELD_COMPARISON_WORLD_ID, scripts: selectors.map(selector => ({ selector, read: comparisonScript(selector, '', 'proof') })), read: comparisonScript('#plain', '', 'proof'), settle: comparisonSettlementScript('proof'), cancel: comparisonSettlementScript('proof', true) })
    for (const row of proof.rows) expect(row.report.status, row.selector).toBe(['#plain', '#disabled', '#readonly'].includes(row.selector) ? 'matched' : 'unavailable')
    for (const row of proof.transitions) { expect(row.report.status).toBe('matched'); expect(row.settled).toBe(false) }
    expect(proof.authorCalls).toBe(0)
    expect(JSON.stringify(proof)).not.toContain('ACTUAL_PRIVATE')
  })
}

// Diagnostic proof of a candidate protocol limit, not an expected product pass:
// real renderer settlement completes before its cached boolean is delivered.
// No prototype tool is exposed and no existing API defect is claimed here.
test('demonstrates the target gap after renderer settlement and before publication', async ({ electronApp }, testInfo) => {
  const rows = await electronApp.evaluate(async ({ BrowserWindow }, input) => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'comparison-publication-gap' } })
    const page = window.webContents
    const read = (code: string) => page.executeJavaScriptInIsolatedWorld(input.world, [{ code }], false)
    const context = () => ({ contents: page.id, frame: page.mainFrame.routingId, process: page.mainFrame.processId, loading: page.isLoadingMainFrame() })
    const rows = []
    try {
      for (const scenario of ['unchanged', 'replacement before settlement', 'replacement after settlement', 'sensitive ABA after settlement']) {
        await page.loadURL('data:text/html,<input id="target" value="SYNTHETIC_EXPECTED_CANARY">')
        await page.executeJavaScript('globalThis.originalTarget=target;globalThis.mutations=0;new MutationObserver(()=>mutations++).observe(document,{subtree:true,attributes:true,childList:true});void 0', false)
        const before = context()
        const report = await read(input.acquire)
        if (scenario === 'replacement before settlement') await page.executeJavaScript('target.replaceWith(target.cloneNode());void 0', false)
        // Hold caller-visible completion AFTER the real renderer has returned
        // true. No guessed timeout or fake settlement value is involved.
        const rendererSettlement = await read(input.settle)
        if (scenario === 'replacement after settlement') await page.executeJavaScript('target.replaceWith(target.cloneNode());void 0', false)
        if (scenario === 'sensitive ABA after settlement') await page.executeJavaScript("target.autocomplete='one-time-code';target.removeAttribute('autocomplete');void 0", false)
        const mutationProof = await page.executeJavaScript('({sameTarget:target===originalTarget,mutations})', false)
        const after = context()
        // Proposed borrowed protocol would now deliver this cached settlement
        // and publish after only main-process lifecycle/authority checks.
        rows.push({ scenario, report, rendererSettlement, mutationProof, before, after })
      }
      return rows
    } finally { window.destroy() }
  }, { world: FIELD_COMPARISON_WORLD_ID, acquire: comparisonScript('#target', 'SYNTHETIC_EXPECTED_CANARY', 'proof'), settle: comparisonSettlementScript('proof') })
  for (const row of rows) { expect(row.report.status).toBe('matched'); expect(row.after).toEqual(row.before) }
  expect(rows[0]).toMatchObject({ rendererSettlement: true, mutationProof: { sameTarget: true, mutations: 0 } })
  expect(rows[1]).toMatchObject({ rendererSettlement: false, mutationProof: { sameTarget: false } })
  expect(rows[2]).toMatchObject({ rendererSettlement: true, mutationProof: { sameTarget: false } })
  expect(rows[3]).toMatchObject({ rendererSettlement: true, mutationProof: { sameTarget: true } })
  expect(rows[2]!.mutationProof.mutations).toBeGreaterThan(0)
  expect(rows[3]!.mutationProof.mutations).toBeGreaterThan(0)
  expect(JSON.stringify(rows)).not.toContain('SYNTHETIC_EXPECTED_CANARY')
  await testInfo.attach('field-comparison-publication-gap', { body: Buffer.from(JSON.stringify(rows, null, 2)), contentType: 'application/json' })
})
