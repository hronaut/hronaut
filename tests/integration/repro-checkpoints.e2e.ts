import { createServer } from 'node:http'
import { stripVTControlCharacters } from 'node:util'
import type { Page } from '@playwright/test'
import { formatReproAsPlaywright } from '../../src/shared/repro-export.js'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('exports explicit Repro expectations that fail broken CRUD and pass the corrected page', async ({ appWindow, electronApp }) => {
  let fixed = false
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<html><title>Checkpoint fixture</title><main><button onclick="document.querySelector('p').textContent='${fixed ? 'Item created' : 'Create failed'}'">Create item</button><p id="result">Ready</p><input value="private-input"></main></html>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  try {
    const state = await appWindow.evaluate(async url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    const tabId = state.activeTabId!
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect(page.getByRole('button', { name: 'Create item' })).toBeVisible()
    const initial = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    await page.getByRole('button', { name: 'Create item' }).click()
    await expect.poll(() => appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', tabId).then(r => r.steps.some(s => s.kind === 'click')), tabId)).toBe(true)
    const checkpoint = { context: initial.checkpointContext!, selector: '#result', condition: 'text' as const, text: 'Item created', reviewed: true as const }
    const report = await appWindow.evaluate(({ tabId, checkpoint }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, checkpoint), { tabId, checkpoint })
    expect(report.steps.at(-1)?.expectation).toEqual({ condition: 'text', text: 'Item created', observedMatch: false })
    expect(JSON.stringify(report)).not.toContain('private-input')
    await expect(appWindow.evaluate(({ tabId, checkpoint }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, { ...checkpoint, selector: 'input' }), { tabId, checkpoint })).rejects.toThrow('form values')
    const afterRejected = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', tabId), tabId)
    expect(afterRejected.steps).toEqual(report.steps)
    expect(JSON.stringify(afterRejected)).not.toContain('private-input')
    const stopped = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', tabId), tabId)
    await expect(appWindow.evaluate(({ tabId, checkpoint }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, checkpoint), { tabId, checkpoint })).rejects.toThrow('context changed')
    const code = formatReproAsPlaywright(stopped).replace(/^import .*\n/, '')
    const run = () => {
      let execution: Promise<void> | undefined
      const register = (_title: string, body: (context: { page: Page }) => Promise<void>) => { execution = body({ page }) }
      new Function('test', 'expect', code)(register, expect.configure({ timeout: 500 }))
      if (!execution) throw new Error('Generated test did not register')
      return execution
    }
    await expect(run()).rejects.toThrow('toHaveText')
    fixed = true
    await run()
    await expect(page.locator('p')).toHaveText('Item created')
    const next = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    await page.reload()
    await expect(appWindow.evaluate(({ tabId, context }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, { context, selector: 'p', condition: 'visible', reviewed: true }), { tabId, context: next.checkpointContext! })).rejects.toThrow('context changed')
  } finally { await closeFixtureServer(server) }
})


test('exports checked-state assertions without form values and detects both broken outcomes', async ({ appWindow, electronApp }) => {
  let outcome: 'broken' | 'partial' | 'fixed' = 'broken'
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<html><title>Checked checkpoint fixture</title><input id="checkbox" type="checkbox" value="private-checkbox-canary" ${outcome !== 'broken' ? 'checked' : ''}><input id="radio" type="radio" value="private-radio-canary" ${outcome !== 'fixed' ? 'checked' : ''}><input id="password" type="password" value="private-password-canary"></html>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  try {
    const state = await appWindow.evaluate(async url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    const tabId = state.activeTabId!
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect(page.locator('#checkbox')).toBeVisible()
    const initial = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    for (const [selector, condition] of [['#checkbox', 'checked'], ['#radio', 'unchecked']] as const) {
      const report = await appWindow.evaluate(({ tabId, checkpoint }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, checkpoint), { tabId, checkpoint: { context: initial.checkpointContext!, selector, condition, reviewed: true as const } })
      expect(report.steps.at(-1)?.expectation).toEqual({ condition, observedMatch: false })
    }
    await expect(page.locator('#checkbox')).not.toBeChecked()
    await expect(page.locator('#radio')).toBeChecked()
    await expect(appWindow.evaluate(({ tabId, context }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, { context, selector: '#password', condition: 'checked', reviewed: true }), { tabId, context: initial.checkpointContext! })).rejects.toThrow('native checkbox or radio')
    const stopped = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', tabId), tabId)
    expect(stopped.steps.filter(step => step.kind === 'expect')).toHaveLength(2)
    const exported = formatReproAsPlaywright(stopped)
    expect(JSON.stringify(stopped) + exported).not.toContain('private-')
    const run = () => {
      let execution: Promise<void> | undefined
      const register = (_title: string, body: (context: { page: Page }) => Promise<void>) => { execution = body({ page }) }
      new Function('test', 'expect', exported.replace(/^import .*\n/, ''))(register, expect.configure({ timeout: 500 }))
      if (!execution) throw new Error('Generated test did not register')
      return execution
    }
    await expect(run()).rejects.toThrow('toBeChecked')
    outcome = 'partial'
    const partialFailure = await run().then(() => '', error => stripVTControlCharacters(String(error)))
    expect(partialFailure).toContain('not.toBeChecked()')
    await expect(page.locator('#checkbox')).toBeChecked()
    await expect(page.locator('#radio')).toBeChecked()
    outcome = 'fixed'
    await run()
    await expect(page.locator('#checkbox')).toBeChecked()
    await expect(page.locator('#radio')).not.toBeChecked()
  } finally { await closeFixtureServer(server) }
})
