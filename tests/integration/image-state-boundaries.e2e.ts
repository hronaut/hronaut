import { imageStateScript, imageStateSettlementScript } from '../../src/main/browser/image-state.js'
import { test, expect } from './fixtures.js'

for (const change of ['replace-before', 'replace-after', 'detach-reinsert', 'ambiguous', 'document-limit'] as const) {
  test(`image state sampled target boundary ${change}`, async ({ electronApp }, info) => {
    const proof = await electronApp.evaluate(async ({ BrowserWindow }, { acquire, settle, change }) => {
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
      const page = window.webContents
      try {
        await page.loadURL('data:text/html,<img id="target">')
        const result = await page.executeJavaScriptInIsolatedWorld(1022, [{ code: acquire.replace('deadline=0', 'deadline=' + (Date.now() + 5000)) }], false)
        const replace = () => page.executeJavaScript("document.getElementById('target').replaceWith(document.getElementById('target').cloneNode());void 0")
        if (change === 'replace-before') await replace()
        if (change === 'detach-reinsert') await page.executeJavaScript("{const element=document.getElementById('target');element.remove();document.body.append(element)};void 0")
        if (change === 'ambiguous') await page.executeJavaScript("document.body.append(document.getElementById('target').cloneNode());void 0")
        if (change === 'document-limit') await page.executeJavaScript("{const fragment=document.createDocumentFragment();for(let i=0;i<5000;i++)fragment.append(document.createElement('span'));document.body.append(fragment)};void 0")
        const valid = await page.executeJavaScriptInIsolatedWorld(1022, [{ code: settle }], false)
        if (change === 'replace-after') await replace()
        const handles = await page.executeJavaScriptInIsolatedWorld(1022, [{ code: 'globalThis.__hronautImageState.size' }], false)
        return { result, valid, handles }
      } finally { window.destroy() }
    }, { acquire: imageStateScript('#target', 'boundary', 0), settle: imageStateSettlementScript('boundary'), change })
    await info.attach('sampled-image-boundary', { body: JSON.stringify({ change, ...proof }), contentType: 'application/json' })
    expect(proof.result).toMatchObject({ complete: true, naturalWidth: 0, naturalHeight: 0 })
    expect(proof.valid).toBe(change === 'replace-after' || change === 'detach-reinsert')
    expect(proof.handles).toBe(0)
  })
}

test('bounds native selector matches before lookup and rejects unsupported contexts', async ({ electronApp }) => {
  const proof = await electronApp.evaluate(async ({ BrowserWindow }, scripts) => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    const page = window.webContents
    const read = async (key: string) => {
      const result = await page.executeJavaScriptInIsolatedWorld(1022, [{ code: scripts[key]!.read.replace('deadline=0', 'deadline=' + (Date.now() + 5000)) }], false)
      if (!result.failure) await page.executeJavaScriptInIsolatedWorld(1022, [{ code: scripts[key]!.settle }], false)
      return result
    }
    try {
      await page.loadURL('data:text/html,<img id="target"><iframe></iframe><svg><image id="svgImage"/></svg><div id="host"></div>')
      await page.executeJavaScript("document.getElementById('host').attachShadow({mode:'open'}).innerHTML='<img id=shadowImage>';void 0")
      const initial = Object.fromEntries(await Promise.all(['invalid', 'tolerant', 'frame', 'svg', 'shadow', 'scope'].map(async key => [key, await read(key)])))
      await page.executeJavaScript("{const count=document.querySelectorAll('*').length,fragment=document.createDocumentFragment();for(let i=count;i<5000;i++)fragment.append(document.createElement('span'));document.body.append(fragment)};void 0")
      const atLimit = await read('target')
      await page.executeJavaScript("document.body.append(document.createElement('span'));void 0")
      await page.executeJavaScriptInIsolatedWorld(1022, [{ code: "Document.prototype.querySelectorAll=()=>{throw Error('PRIVATE selector must not execute past limit')};void 0" }], false)
      const overLimit = await read('target')
      return { initial, atLimit, overLimit }
    } finally { window.destroy() }
  }, Object.fromEntries(Object.entries({ target: '#target', invalid: '[PRIVATE==', tolerant: '[PRIVATE', frame: 'iframe', svg: '#svgImage', shadow: '#shadowImage', scope: ':scope > body > img' }).map(([key, selector]) => [key, { read: imageStateScript(selector, key, 0), settle: imageStateSettlementScript(key) }])))
  expect(proof.initial).toMatchObject({ invalid: { failure: 'invalid-selector' }, tolerant: { failure: 'missing-target' }, frame: { failure: 'unsupported-target' }, svg: { failure: 'unsupported-target' }, shadow: { failure: 'missing-target' }, scope: { complete: true } })
  expect(proof.atLimit).toMatchObject({ complete: true })
  expect(proof.overLimit).toEqual({ failure: 'document-limit' })
  expect(JSON.stringify(proof)).not.toContain('PRIVATE')
})

test('image native acquisition scrubs invalid scalars and rejects XML documents', async ({ electronApp }) => {
  const proof = await electronApp.evaluate(async ({ BrowserWindow }, script) => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    const page = window.webContents
    try {
      await page.loadURL('data:text/html,<img id="target">')
      const failures = []
      for (const [name, expression] of [['complete', "'PRIVATE'"], ['naturalWidth', 'NaN'], ['naturalHeight', '-1'], ['currentSrc', '({private:true})'], ['currentSrc', "(()=>{throw Error('PRIVATE native details')})()"]]) {
        const setup = `globalThis.__savedImageGetter=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,${JSON.stringify(name)});Object.defineProperty(HTMLImageElement.prototype,${JSON.stringify(name)},{get(){return ${expression}},configurable:true});void 0`
        await page.executeJavaScriptInIsolatedWorld(1022, [{ code: setup }], false)
        try { failures.push(await page.executeJavaScriptInIsolatedWorld(1022, [{ code: script.replace('deadline=0', 'deadline=' + (Date.now() + 5000)) }], false)) }
        finally { await page.executeJavaScriptInIsolatedWorld(1022, [{ code: `Object.defineProperty(HTMLImageElement.prototype,${JSON.stringify(name)},globalThis.__savedImageGetter);delete globalThis.__savedImageGetter;void 0` }], false) }
      }
      const pending = await page.executeJavaScriptInIsolatedWorld(1022, [{ code: 'globalThis.__hronautImageState.size' }], false)
      await page.loadURL('data:application/xhtml+xml,' + encodeURIComponent('<html xmlns="http://www.w3.org/1999/xhtml"><body><img id="target" /></body></html>'))
      const xml = await page.executeJavaScriptInIsolatedWorld(1022, [{ code: script.replace('deadline=0', 'deadline=' + (Date.now() + 5000)) }], false)
      return { failures, pending, xml }
    } finally { window.destroy() }
  }, imageStateScript('#target', 'invalid', 0))
  expect(proof.failures).toEqual(Array.from({ length: 5 }, () => ({ failure: 'native-unavailable' })))
  expect(proof.pending).toBe(0)
  expect(proof.xml).toEqual({ failure: 'unsupported-document' })
  expect(JSON.stringify(proof)).not.toContain('PRIVATE')
})
