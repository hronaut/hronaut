import { createServer } from 'node:http'
import { elementScrollGeometrySource } from '../../src/main/browser/element-scroll-geometry.js'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Playwright DOM trace snapshots themselves call page-authored scroll getters.
// Keep execution tracing while excluding that independent DOM traversal.
test.use({ trace: { mode: 'retain-on-failure', snapshots: false, screenshots: true, sources: true } })

test('isolated native scroll getters ignore page-authored accessors without mutation', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Native geometry proof</title>
      <button id="focus">Keep focus</button><div id="target" style="width:120px;height:80px;overflow:auto"><div style="width:400px;height:600px"></div></div>
      <script>
        window.getterHits = [];
        const bad = () => { window.getterHits.push(new Error('Page getter executed').stack); throw new Error('Page getter executed'); };
        for (const key of ['scrollTop','scrollLeft','clientWidth','clientHeight','scrollWidth','scrollHeight']) {
          Object.defineProperty(target, key, {get:bad});
          Object.defineProperty(Element.prototype, key, {get:bad});
        }
        Object.defineProperty(Document.prototype, 'scrollingElement', {get:bad});
        document.getElementById('focus').focus();
      </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect(page.locator('#target')).toBeVisible()
    const before = await page.evaluate(() => ({ html: document.body.innerHTML, focus: document.activeElement?.id, x: scrollX, y: scrollY }))
    const result = await electronApp.evaluate(async ({ webContents }, { url, source }) => {
      const contents = webContents.getAllWebContents().find(page => page.getURL() === url)!
      await contents.executeJavaScript('window.getterHits = []; void 0')
      return contents.executeJavaScriptInIsolatedWorld(1006, [{ code: `(() => {
        const element = document.querySelector('#target');
        return ${source};
      })()` }], false)
    }, { url, source: elementScrollGeometrySource() })
    expect(result).toEqual({ status: 'observed', scrollTop: 0, scrollLeft: 0, clientWidth: 105, clientHeight: 65, scrollWidth: 400, scrollHeight: 600, direction: 'ltr', writingMode: 'horizontal-tb', documentScroller: 'html', isDocumentScroller: false })
    expect(await page.evaluate(() => (window as unknown as { getterHits: string[] }).getterHits)).toEqual([])
    expect(await page.evaluate(() => ({ html: document.body.innerHTML, focus: document.activeElement?.id, x: scrollX, y: scrollY }))).toEqual(before)
  } finally {
    await closeFixtureServer(server)
  }
})
