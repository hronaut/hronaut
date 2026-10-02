import { createServer } from 'node:http'
import type { Page } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { formatReproAsPlaywright } from '../../src/shared/repro-export.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

for (const variant of ['', 'size=3', 'multiple size=3']) {
  test(`replays redacted native select type-ahead (${variant || 'closed'})`, async ({ appWindow, electronApp }) => {
    let unavailable: '' | 'disabled' | 'hidden' = ''
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<title>Select fixture</title><input autofocus value="unchanged"><label>Choice<select ${variant} ${unavailable} onchange="document.querySelector('p').textContent='Chosen: '+this.selectedOptions[0].label"><option value="private-alpha">Alpha</option><option value="private-beta">Beta</option><option value="private-gamma">Gamma</option></select></label><p>Chosen: Alpha</p>`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No fixture port')
    const url = `http://127.0.0.1:${address.port}/`
    try {
      const state = await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
      const tabId = state.activeTabId!
      await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
      const page = electronApp.context().pages().find(page => page.url() === url)!
      await page.locator('select').focus()
      const initial = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', id), tabId)
      await electronApp.evaluate(({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        contents.focus()
        contents.sendInputEvent({ type: 'keyDown', keyCode: 'b' })
        contents.sendInputEvent({ type: 'char', keyCode: 'b' })
        contents.sendInputEvent({ type: 'keyUp', keyCode: 'b' })
      }, url)
      await expect(page.locator('select')).toHaveValue('private-beta')
      await expect(page.locator('p')).toHaveText('Chosen: Beta')
      await appWindow.evaluate(({ tabId, context }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, {
        context, selector: 'p', condition: 'text', text: 'Chosen: Beta', reviewed: true
      }), { tabId, context: initial.checkpointContext! })
      const recording = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', id), tabId)
      const code = formatReproAsPlaywright(recording)
      expect(JSON.stringify(recording) + code).not.toContain('private-')
      expect(recording.steps.find(step => step.kind === 'input')).toMatchObject({ valueRedacted: true, target: { tag: 'select' } })
      expect(recording.steps.find(step => step.kind === 'input')).not.toHaveProperty('key')
      const names = [...code.matchAll(/process\.env\.(HRONAUT_REPRO_INPUT_\d+)/g)].map(match => match[1]!)
      expect(names).toHaveLength(1)
      const run = () => {
        let execution: Promise<void> | undefined
        new Function('test', 'expect', code.replace(/^import[^\n]*\n/u, ''))((_title: string, body: (context: { page: Page }) => Promise<void>) => {
          execution = body({ page })
        }, expect.configure({ timeout: 700 }))
        if (!execution) throw new Error('Generated test did not register')
        return execution
      }
      await expect(run()).rejects.toThrow('Set HRONAUT_REPRO_INPUT_')
      try {
        process.env[names[0]!] = 'b'
        for (const state of ['disabled', 'hidden'] as const) {
          unavailable = state
          await expect(run()).rejects.toThrow(state === 'disabled' ? 'toBeEnabled' : 'toBeFocused')
          await expect(page.locator('input')).toHaveValue('unchanged')
        }
        unavailable = ''
        process.env[names[0]!] = 'g'
        await expect(run()).rejects.toThrow('toHaveText')
        process.env[names[0]!] = 'b'
        await run()
        expect(await page.locator('select').evaluate((select: HTMLSelectElement) => [...select.selectedOptions].map(option => option.value))).toEqual(['private-beta'])
      } finally {
        for (const name of names) delete process.env[name]
      }
    } finally { await closeFixtureServer(server) }
  })
}
