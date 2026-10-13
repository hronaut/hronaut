import { test, expect } from './capability-fixtures.js'
import { installReplacementProbe, readReplacementProbe, restoreReplacementProbe } from './semantic-replacement-fixture.js'

// Characterize operation-local retention and the documented post-sample gap.
// These controls do not reconstruct the earlier uninstrumented flaky failure.
for (const target of ['selector', 'ref'] as const) for (const phase of ['before-acquire', 'after-final'] as const) {
  test(`semantic replacement boundary ${target} ${phase}`, async ({ capabilities, electronApp }, info) => {
    const { client, tabId, fixtureUrl } = capabilities
    await electronApp.evaluate(async ({ webContents }, url) => {
      await webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(`(() => {
        document.body.innerHTML='<button id="target" style="position:fixed;left:120.125px;top:120.375px;width:200.5px;height:100.5px"><span id="child" style="display:block;width:100%;height:100%">Target</span></button>';
        window.original=document.getElementById('target');window.events=[];
        for(const type of ['mousedown','mouseup','click'])document.addEventListener(type,e=>window.events.push({type,target:e.target.id,original:window.original.contains(e.target),trusted:e.isTrusted}),true);
        return true;
      })()`)
    }, fixtureUrl)
    let ref: string | undefined
    if (target === 'ref') {
      expect((await client.callTool({ name: 'browser_snapshot', arguments: { tabId } })).isError).not.toBe(true)
      ref = await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript("document.getElementById('target').getAttribute('data-hronaut-ref')"), fixtureUrl)
      expect(ref).toBeTruthy()
    }
    try {
      await installReplacementProbe(electronApp, fixtureUrl, phase)
      const result = await client.callTool({ name: 'browser_click', arguments: { tabId, native: true, ...(target === 'ref' ? { ref } : { selector: '#target' }) } })
      const observed = await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript('window.events'), fixtureUrl)
      const replacement = await readReplacementProbe(electronApp)
      await info.attach('replacement-boundary', { body: JSON.stringify({ target, phase, result, observed, replacement }), contentType: 'application/json' })
      expect(result.isError, JSON.stringify(result)).not.toBe(true)
      expect(replacement.replacements).toBe(1)
      const acquisition = replacement.timeline.filter(e => e.event === 'acquire-start' || e.event === 'acquire-end')
      expect(acquisition).toEqual(['acquire-start', 'acquire-end'].map(event => ({ event, originalConnected: phase !== 'before-acquire' })))
      const samples = replacement.timeline.filter(e => e.event === 'sample-end')
      expect(samples).toEqual([false, true].map(final => ({ event: 'sample-end', final, value: 'ADMITTED' })))
      const index = (event: string) => replacement.timeline.findIndex(e => e.event === event)
      const replaceIndex = index('replace')
      expect(index('installed')).toBeLessThan(replaceIndex)
      if (phase === 'before-acquire') expect(replaceIndex).toBeLessThan(index('acquire-start'))
      else expect(replaceIndex).toBeGreaterThan(replacement.timeline.findIndex(e => e.event === 'sample-end' && e.final === true))
      expect(replaceIndex).toBeLessThan(replacement.timeline.findIndex(e => e.event === 'dispatch' && e.type === 'mousePressed'))
      expect(observed).toEqual(['mousedown', 'mouseup', 'click'].map(type => ({ type, target: 'child', original: false, trusted: true })))
    } finally { await restoreReplacementProbe(electronApp) }
  })
}
