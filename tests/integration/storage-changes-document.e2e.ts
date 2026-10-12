import { createServer } from 'node:http'
import type { BrowserStorageChangesReport, HronautApi } from '../../src/shared/types.js'
import { test, expect } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

type Probe = { held: boolean; cookieUrls: string[]; release(): void; restore(): void; listeners: number }
type Scope = typeof globalThis & { __storageDocumentProbe?: Probe }

for (const action of ['baseline', 'compare'] as const) for (const stage of ['dom', 'cookies'] as const) for (const change of ['same-origin', 'reload', 'away-and-back', 'pending-reload', 'unchanged'] as const) {
  if (change === 'pending-reload' && stage === 'cookies') continue
  test(`storage ${action} ${change === 'unchanged' ? 'accepts' : 'rejects'} ${change} document ${change === 'pending-reload' ? 'before' : 'after'} ${stage} read`, async ({ capabilities, electronApp, appWindow }, info) => {
    const { client, tabId } = capabilities
    let marker = 'original'
    let holdResponse = false
    let releaseResponse: (() => void) | undefined
    let navigation: Promise<void> | undefined
    const server = createServer(async (request, response) => {
      if (request.url !== '/original' && request.url !== '/replacement') { response.writeHead(404); response.end(); return }
      if (holdResponse && request.url === '/original') {
        holdResponse = false
        await new Promise<void>(resolve => { releaseResponse = resolve })
      }
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
      response.end(`<title>Document-bound storage</title><script>
        localStorage.setItem('document_marker', '${marker}');sessionStorage.setItem('document_marker', '${marker}');
        document.cookie='document_marker=${marker};path=/';
      </script>`)
    })
    let pending: Promise<{ ok: boolean; result?: BrowserStorageChangesReport; error?: string }> | undefined
    const capture = (captureAction: 'baseline' | 'compare' | 'get') => appWindow.evaluate(async ({ tabId, action }) => {
      try {
        const result = await (window as unknown as { hronaut: HronautApi }).hronaut.storageChanges({ tabId, action, includeValues: true })
        return { ok: true, result }
      } catch (error) { return { ok: false, error: String(error) } }
    }, { tabId, action: captureAction })
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw Error('Missing storage fixture address')
      const origin = `http://127.0.0.1:${address.port}`
      const url = `${origin}/original`
      expect((await client.callTool({ name: 'browser_navigate', arguments: { tabId, url } })).isError).not.toBe(true)
      const pageId = await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.id, url)
      await expect.poll(() => electronApp.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript("localStorage.getItem('document_marker')"), pageId)).toBe('original')
      expect((await capture('baseline')).ok).toBe(true)
      if (action === 'compare') {
        await electronApp.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript("localStorage.setItem('document_marker','completed');sessionStorage.setItem('document_marker','completed');document.cookie='document_marker=completed;path=/';true"), pageId)
        expect((await capture('compare')).ok).toBe(true)
      }
      const completed = (await capture('get')).result!
      await electronApp.evaluate(async ({ webContents }, { id, stage, change }) => {
        const page = webContents.fromId(id)!
        await page.executeJavaScript("localStorage.setItem('document_marker','pending');sessionStorage.setItem('document_marker','pending');document.cookie='document_marker=pending;path=/';true")
        const execute = page.executeJavaScript.bind(page)
        const cookieStore = page.session.cookies
        const get = cookieStore.get.bind(cookieStore)
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        const probe: Probe = { held: false, cookieUrls: [], release, listeners: page.listenerCount('did-navigate'), restore: () => { page.executeJavaScript = execute; cookieStore.get = get } }
        ;(globalThis as Scope).__storageDocumentProbe = probe
        page.executeJavaScript = async (code, userGesture) => {
          const snapshotRead = code.includes('const fingerprint = (value) =>')
          if (change === 'pending-reload' && snapshotRead) { probe.held = true; await gate }
          const result = await execute(code, userGesture)
          if (change !== 'pending-reload' && stage === 'dom' && snapshotRead) { probe.held = true; await gate }
          return result
        }
        cookieStore.get = async filter => {
          probe.cookieUrls.push(filter.url ?? '')
          const result = await get(filter)
          if (stage === 'cookies') { probe.held = true; await gate }
          return result
        }
      }, { id: pageId, stage, change })
      if (change === 'pending-reload') {
        holdResponse = true
        navigation = electronApp.evaluate(async ({ webContents }, { id, url }) => { await webContents.fromId(id)!.loadURL(url) }, { id: pageId, url })
        await expect.poll(() => Boolean(releaseResponse)).toBe(true)
      }
      pending = capture(action)
      await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__storageDocumentProbe?.held)).toBe(true)
      marker = 'new-document'
      if (change === 'pending-reload') {
        expect(await electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)!.listenerCount('did-navigate') - (globalThis as Scope).__storageDocumentProbe!.listeners, pageId)).toBe(1)
        releaseResponse!()
        await navigation
      } else if (change !== 'unchanged') await electronApp.evaluate(async ({ webContents }, { id, origin, change }) => {
        const page = webContents.fromId(id)!
        await page.loadURL(`${origin}/${change === 'reload' ? 'original' : 'replacement'}`)
        if (change === 'away-and-back') await page.loadURL(`${origin}/original`)
      }, { id: pageId, origin, change })
      expect(await electronApp.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript("localStorage.getItem('document_marker')"), pageId)).toBe(change === 'unchanged' ? 'pending' : 'new-document')
      await electronApp.evaluate(() => (globalThis as Scope).__storageDocumentProbe!.release())
      const result = await pending
      const observed = await electronApp.evaluate(({ webContents }, id) => {
        const probe = (globalThis as Scope).__storageDocumentProbe!
        const result = { cookieUrls: probe.cookieUrls, listenerDelta: webContents.fromId(id)!.listenerCount('did-navigate') - probe.listeners }
        probe.restore()
        return result
      }, pageId)
      const retained = (await capture('get')).result!
      await info.attach('document-capture', { body: JSON.stringify({ result, observed, completed, retained }), contentType: 'application/json' })
      expect(observed.listenerDelta).toBe(0)
      if (change === 'unchanged') {
        expect(result.ok).toBe(true)
        expect(observed.cookieUrls).toEqual([url])
        expect(retained.status).toBe(action === 'baseline' ? 'baseline' : 'compared')
        if (action === 'compare') {
          expect(retained.changes.filter(row => row.key === 'document_marker')).toHaveLength(3)
          expect(retained.changes.filter(row => row.key === 'document_marker').every(row => row.beforeValue === 'original' && row.afterValue === 'pending')).toBe(true)
        }
        return
      }
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Storage comparison changed')
      expect(observed.cookieUrls).toEqual(stage === 'dom' ? [] : [url])
      expect(observed.listenerDelta).toBe(0)
      expect(retained).toMatchObject({ status: completed.status, baselineAt: completed.baselineAt, changes: completed.changes })
      expect(retained.comparedAt).toBe(completed.comparedAt)
      const fresh = (await capture('compare')).result!
      expect(fresh.changes.filter(row => row.key === 'document_marker')).toHaveLength(3)
      expect(fresh.changes.filter(row => row.key === 'document_marker').every(row => row.beforeValue === 'original' && row.afterValue === 'new-document')).toBe(true)
    } finally {
      releaseResponse?.()
      await navigation?.catch(() => undefined)
      await electronApp.evaluate(() => { const probe = (globalThis as Scope).__storageDocumentProbe; probe?.release(); probe?.restore(); delete (globalThis as Scope).__storageDocumentProbe })
      await pending?.catch(() => undefined)
      await closeFixtureServer(server)
    }
  })
}
