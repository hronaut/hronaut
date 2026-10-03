import { createServer } from 'node:http'
import type { Page } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { formatReproAsPlaywright } from '../../src/shared/repro-export.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const variants = [
  ['button-default', '<button>Activate</button>', 1, 1, 0],
  ['button-button', '<button type="button">Activate</button>', 1, 0, 0],
  ['button-submit', '<button type="submit">Activate</button>', 1, 1, 0],
  ['button-reset', '<button type="reset">Activate</button>', 1, 0, 1],
  ['input-button', '<input type="button" value="private-control-value">', 1, 0, 0],
  ['input-submit', '<input type="submit" value="private-control-value">', 1, 1, 0],
  ['input-reset', '<input type="reset" value="private-control-value">', 1, 0, 1],
  ['input-image', '<input type="image" alt="Activate" width="80" height="40">', 1, 1, 0]
] as const

for (const [name, markup, clicks, submits, resets] of variants) {
  test(`replays native Space activation on ${name}`, async ({ appWindow, electronApp }) => {
    const expected = `Clicks ${clicks}; submits ${submits}; resets ${resets}`
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<title>Button Space fixture</title><form>${markup}</form><p></p><script>let clicks=0,submits=0,resets=0; const render=()=>document.querySelector('p').textContent='Clicks '+clicks+'; submits '+submits+'; resets '+resets;document.querySelector('form').firstElementChild.onclick=()=>{clicks++;render()};document.querySelector('form').onsubmit=e=>{e.preventDefault();submits++;render()};document.querySelector('form').onreset=()=>{resets++;render()};render()</script>`)
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
      await page.locator('form > :first-child').focus()
      const initial = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', id), tabId)
      await electronApp.evaluate(({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        contents.focus()
        contents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
        contents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
      }, url)
      await expect(page.locator('p')).toHaveText(expected)
      await appWindow.evaluate(({ tabId, context, expected }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, {
        context, selector: 'p', condition: 'text', text: expected, reviewed: true
      }), { tabId, context: initial.checkpointContext!, expected })
      const recording = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', id), tabId)
      const code = formatReproAsPlaywright(recording)
      expect(recording.steps.filter(step => step.kind === 'key')).toMatchObject([{ key: 'Space' }])
      expect(recording.steps.some(step => step.kind === 'input')).toBe(false)
      expect(code).not.toContain('HRONAUT_REPRO_INPUT_')
      expect(JSON.stringify(recording) + code).not.toContain('private-control-value')
      let execution: Promise<void> | undefined
      new Function('test', 'expect', code.replace(/^import[^\n]*\n/u, ''))((_title: string, body: (context: { page: Page }) => Promise<void>) => { execution = body({ page }) }, expect)
      if (!execution) throw new Error('No generated test')
      await execution
      await expect(page.locator('p')).toHaveText(expected)
    } finally { await closeFixtureServer(server) }
  })
}
