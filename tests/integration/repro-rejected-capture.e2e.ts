import { createServer } from 'node:http'
import type { Page } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { formatReproAsPlaywright } from '../../src/shared/repro-export.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

for (const kind of ['click', 'key'] as const) {
  for (const rejected of [false, true]) {
    test(`preserves accepted ${kind} capture completeness (rejected=${rejected})`, async ({ appWindow, electronApp }) => {
      let posts = 0
      let releasePost: (() => void) | undefined
      let holdPost = true
      const server = createServer((request, response) => {
        request.resume()
        if (request.url === '/submit') {
          if (request.method === 'POST') posts++
          const finish = () => { if (!response.writableEnded) { response.writeHead(200); response.end('ok') } }
          if (holdPost) releasePost = finish
          else finish()
          return
        }
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end(request.url === '/done' ? '<title>Destination</title><h1>Fixture</h1><p>Request received</p>' : `<title>Fetch submission</title><h1>Fixture</h1><button onclick="fetch('/submit',{method:'POST'}).then(()=>location.href='/done')">Submit request</button>`)
      })
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No port')
      const url = `http://127.0.0.1:${address.port}/`
      try {
        const state = await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
        const tabId = state.activeTabId!
        await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
        const page = electronApp.context().pages().find(page => page.url() === url)!
        if (kind === 'key') await page.locator('button').focus()
        await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', id), tabId)
        if (rejected) await electronApp.evaluate(({ webContents }, { url, kind }) => {
          const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
          const original = contents.executeJavaScript.bind(contents)
          Object.defineProperty(contents, 'executeJavaScript', { configurable: true, value: (code: string, gesture?: boolean) => {
            if (code.includes(kind === 'click' ? 'const point = {' : 'const point = undefined')) {
              Object.defineProperty(contents, 'executeJavaScript', { configurable: true, value: original })
              ;(globalThis as typeof globalThis & { rejectedTarget?: boolean }).rejectedTarget = true
              return Promise.reject(new Error('Synthetic target failure'))
            }
            return original(code, gesture)
          } })
        }, { url, kind })
        if (kind === 'click') await page.getByRole('button', { name: 'Submit request' }).click()
        else await electronApp.evaluate(({ webContents }, url) => {
          const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
          contents.focus()
          contents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
          contents.sendInputEvent({ type: 'char', keyCode: '\r' })
          contents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
        }, url)
        await expect.poll(() => Boolean(releasePost)).toBe(true)
        // A checkpoint drains the recording queue without changing recording or navigation.
        const before = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', id), tabId)
        await appWindow.evaluate(({ tabId, context }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, {
          context, selector: 'h1', condition: 'visible', reviewed: true
        }), { tabId, context: before.checkpointContext! })
        if (rejected) expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { rejectedTarget?: boolean }).rejectedTarget)).toBe(true)
        expect(page.url()).toBe(url)
        releasePost!()
        holdPost = false
        await expect(page.locator('p')).toHaveText('Request received')
        expect(posts).toBe(1)
        const current = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', id), tabId)
        await appWindow.evaluate(({ tabId, context }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, {
          context, selector: 'p', condition: 'text', text: 'Request received', reviewed: true
        }), { tabId, context: current.checkpointContext! })
        const recording = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', id), tabId)
        const code = formatReproAsPlaywright(recording)
        const unresolved = recording.steps.filter(step => step.kind === kind && !step.target)
        expect(unresolved).toHaveLength(rejected ? 1 : 0)
        if (rejected) expect(unresolved[0]!.description).toContain('could not be captured')
        expect(JSON.stringify(recording) + code).not.toContain('Synthetic target failure')
        posts = 0
        let error: string | undefined
        try {
          let execution: Promise<void> | undefined
          new Function('test', 'expect', code.replace(/^import[^\n]*\n/u, ''))((_title: string, body: (context: { page: Page }) => Promise<void>) => { execution = body({ page }) }, expect.configure({ timeout: 1000 }))
          if (!execution) throw new Error('No generated test')
          await execution
        } catch (failure) { error = String(failure) }
        if (rejected) {
          expect(error).toContain('TODO: Recreate step')
          expect(posts).toBe(0)
        } else {
          expect(posts).toBe(1)
          // Direct exported navigation can race the fixture's fetch completion.
          // This comparison establishes the accepted action was retained and sent.
          if (error) expect(error).toContain('net::ERR_ABORTED')
        }
      } finally { releasePost?.(); await closeFixtureServer(server) }
    })
  }
}
