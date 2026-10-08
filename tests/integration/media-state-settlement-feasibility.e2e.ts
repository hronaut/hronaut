import { mediaStateScript, mediaStateSettlementScript } from '../../src/main/browser/media-state.js'
import { expect, test } from './fixtures.js'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test('rejects obsolete native media handles without reading replacement nodes', async ({ electronApp }) => {
  const result = await electronApp.evaluate(async ({ BrowserWindow }, scripts) => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'media-settlement-proof' } })
    const page = window.webContents
    const read = (code: string) => page.executeJavaScriptInIsolatedWorld(1020, [{ code }], false)
    const fixture = 'data:text/html,<audio id="target" hidden></audio>'
    const rows: { scenario: string; settled: unknown }[] = []
    try {
      for (const [scenario, mutation] of [
        ['unchanged', 'void 0'],
        ['replacement', 'target.replaceWith(target.cloneNode())'],
        ['detach-reinsert', 'const node=target;node.remove();document.body.append(node)'],
        ['ambiguous', 'document.body.append(target.cloneNode())']
      ]) {
        await page.loadURL(fixture)
        await read(scripts.acquire)
        await page.executeJavaScript(mutation!, false)
        rows.push({ scenario: scenario!, settled: await read(scripts.settle) })
      }
      await page.loadURL(fixture);await read(scripts.acquire);await read(scripts.cancel)
      rows.push({ scenario: 'cancel', settled: await read(scripts.settle) })
      await read(scripts.acquire);await page.loadURL(fixture + '?replacement')
      rows.push({ scenario: 'navigation', settled: await read(scripts.settle) })
      return rows
    } finally { window.destroy() }
  }, { acquire: mediaStateScript({ selector: '#target' }, 'proof'), settle: mediaStateSettlementScript('proof'), cancel: mediaStateSettlementScript('proof', true) })
  expect(result).toEqual([
    { scenario: 'unchanged', settled: true },
    ...['replacement', 'detach-reinsert', 'ambiguous', 'cancel', 'navigation'].map(scenario => ({ scenario, settled: false }))
  ])
})
