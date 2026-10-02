import { createServer } from 'node:http'
import type { Page } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { formatReproAsPlaywright } from '../../src/shared/repro-export.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

for (const delayed of [false, true]) {
  test(`requires action completeness for native POST replay (delayed=${delayed})`, async ({ appWindow, electronApp }) => {
    let posts = 0
    const server = createServer((request, response) => {
      if (request.method === 'POST') posts++
      request.resume()
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(request.url === '/done' ? '<title>Destination</title><p>Request received</p>' : '<title>Native form</title><form action="/done" method="post"><input name="name" required><button>Submit request</button></form>')
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
      await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', id), tabId)
      await page.locator('input').click()
      await electronApp.evaluate(({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        contents.focus()
        for (const keyCode of 'Demo') {
          contents.sendInputEvent({ type: 'keyDown', keyCode })
          contents.sendInputEvent({ type: 'char', keyCode })
          contents.sendInputEvent({ type: 'keyUp', keyCode })
        }
      }, url)
      await expect(page.locator('input')).toHaveValue('Demo')
      if (delayed) await electronApp.evaluate(({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        const original = contents.executeJavaScript.bind(contents)
        let held = false
        Object.defineProperty(contents, 'executeJavaScript', { configurable: true, value: (code: string, gesture?: boolean) => {
          const result = original(code, gesture).catch(() => null)
          if (!held && code.includes('const point = {')) {
            held = true
            return new Promise(resolve => {
              ;(globalThis as typeof globalThis & { releaseRepro?: () => void }).releaseRepro = () => {
                Object.defineProperty(contents, 'executeJavaScript', { configurable: true, value: original })
                resolve(result)
              }
            })
          }
          return result
        } })
      }, url)
      await page.getByRole('button', { name: 'Submit request' }).click()
      await expect(page.locator('p')).toHaveText('Request received')
      expect(posts).toBe(1)
      if (delayed) await electronApp.evaluate(() => {
        const main = globalThis as typeof globalThis & { releaseRepro?: () => void }
        if (!main.releaseRepro) throw new Error('Target not intercepted')
        main.releaseRepro()
        delete main.releaseRepro
      })
      const current = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', id), tabId)
      await appWindow.evaluate(({ tabId, context }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, {
        context, selector: 'p', condition: 'text', text: 'Request received', reviewed: true
      }), { tabId, context: current.checkpointContext! })
      const recording = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', id), tabId)
      const code = formatReproAsPlaywright(recording)
      expect(recording.steps.some(step => step.kind === 'input')).toBe(true)
      expect(JSON.stringify(recording) + code).not.toContain('Demo')
      const unresolved = recording.steps.filter(step => step.kind === 'click' && !step.target)
      if (delayed) {
        expect(unresolved).toHaveLength(1)
        expect(unresolved[0]!.description).toContain('navigation')
      }
      const names = [...code.matchAll(/process\.env\.(HRONAUT_REPRO_INPUT_\d+)/g)].map(match => match[1]!)
      posts = 0
      let error: string | undefined
      try {
        for (const name of names) process.env[name] = 'Safe replacement'
        let execution: Promise<void> | undefined
        new Function('test', 'expect', code.replace(/^import[^\n]*\n/u, ''))((_title: string, body: (context: { page: Page }) => Promise<void>) => { execution = body({ page }) }, expect.configure({ timeout: 1000 }))
        if (!execution) throw new Error('No generated test')
        await execution
      } catch (failure) { error = String(failure) }
      finally { for (const name of names) delete process.env[name] }
      if (delayed || unresolved.length) {
        expect(error).toContain('TODO: Recreate step')
        expect(posts).toBe(0)
      } else {
        expect(error).toBeUndefined()
        expect(posts).toBe(1)
      }
    } finally {
      await electronApp.evaluate(() => {
        const main = globalThis as typeof globalThis & { releaseRepro?: () => void }
        main.releaseRepro?.()
        delete main.releaseRepro
      })
      await closeFixtureServer(server)
    }
  })

}
