import { createServer } from 'node:http'
import { stripVTControlCharacters } from 'node:util'
import type { Page } from '@playwright/test'
import { formatReproAsPlaywright } from '../../src/shared/repro-export.js'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('exports explicit Repro expectations that fail broken CRUD and pass the corrected page', async ({ appWindow, electronApp }) => {
  let fixed = false
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<html><title>Checkpoint fixture</title><main><button onclick="document.querySelector('p').textContent='${fixed ? 'Item cre\u200b\u00adated' : 'Create failed'}'">Create item</button><p id="result">Ready</p><input value="private-input"></main></html>`)
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
    const normalized = await appWindow.evaluate(({ tabId, checkpoint }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, checkpoint), {
      tabId, checkpoint: { ...checkpoint, context: next.checkpointContext! }
    })
    expect(normalized.steps.at(-1)?.expectation?.observedMatch).toBe(true)
    await page.reload()
    await expect(appWindow.evaluate(({ tabId, context }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, { context, selector: 'p', condition: 'visible', reviewed: true }), { tabId, context: next.checkpointContext! })).rejects.toThrow('context changed')
  } finally { await closeFixtureServer(server) }
})


test('exports checked-state assertions without form values and detects both broken outcomes', async ({ appWindow, electronApp }) => {
  let outcome: 'broken' | 'partial' | 'fixed' | 'mixed-checked' | 'mixed-unchecked' = 'broken'
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<html><title>Checked checkpoint fixture</title><input id="checkbox" type="checkbox" value="private-checkbox-canary" ${outcome !== 'broken' ? 'checked' : ''}><input id="radio" type="radio" value="private-radio-canary" ${['broken', 'partial'].includes(outcome) ? 'checked' : ''}><input id="password" type="password" value="private-password-canary"><script>
      if (${JSON.stringify(outcome)} === 'mixed-checked') document.querySelector('#checkbox').indeterminate = true;
      if (${JSON.stringify(outcome)} === 'mixed-unchecked') document.querySelector('#radio').indeterminate = true;
    </script></html>`)
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
    for (const mixed of ['mixed-checked', 'mixed-unchecked'] as const) {
      outcome = mixed
      await expect(run()).rejects.toThrow('toHaveJSProperty')
    }
    outcome = 'fixed'
    await run()
    await expect(page.locator('#checkbox')).toBeChecked()
    await expect(page.locator('#radio')).not.toBeChecked()
  } finally { await closeFixtureServer(server) }
})

test('records rendered visibility consistent with exported Playwright assertions', async ({ appWindow, electronApp }) => {
  let broken = false
  let missing = false
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<html><title>Visibility fixture</title><h1>Ready</h1><main style="content-visibility:${broken ? 'visible' : 'hidden'}">${missing ? '' : '<p id="suppressed" style="width:100px;height:30px">Suppressed</p>'}</main><section id="contents" style="display:contents"><span>Visible child</span></section><article id="text-contents" style="display:contents">Visible text</article><div id="transparent" style="opacity:0">Transparent but laid out</div></html>`)
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
    await expect(page.getByRole('heading', { name: 'Ready' })).toBeVisible()
    const initial = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    for (const [selector, condition] of [['#suppressed', 'hidden'], ['#contents', 'visible'], ['#text-contents', 'visible'], ['#transparent', 'visible']] as const) {
      expect(await page.locator(selector).isVisible()).toBe(condition === 'visible')
      const report = await appWindow.evaluate(({ tabId, checkpoint }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, checkpoint), { tabId, checkpoint: { context: initial.checkpointContext!, selector, condition, reviewed: true as const } })
      expect(report.steps.at(-1)?.expectation).toEqual({ condition, observedMatch: true })
    }
    await page.evaluate(() => {
      const element = document.createElement('aside'); element.id = 'bounded'; element.style.display = 'contents'
      for (let index = 0; index < 1001; index++) element.append(document.createComment(''))
      document.body.append(element)
    })
    await expect(appWindow.evaluate(({ tabId, context }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, { context, selector: '#bounded', condition: 'hidden', reviewed: true }), { tabId, context: initial.checkpointContext! })).rejects.toThrow('select a smaller target')
    const stopped = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', tabId), tabId)
    expect(stopped.steps.filter(step => step.kind === 'expect')).toHaveLength(4)
    const code = formatReproAsPlaywright(stopped).replace(/^import .*\n/, '')
    const run = () => {
      let execution: Promise<void> | undefined
      const register = (_title: string, body: (context: { page: Page }) => Promise<void>) => { execution = body({ page }) }
      new Function('test', 'expect', code)(register, expect.configure({ timeout: 500 }))
      if (!execution) throw new Error('Generated test did not register')
      return execution
    }
    await run()
    missing = true
    await expect(run()).rejects.toThrow('toHaveCount')
    missing = false
    broken = true
    await expect(run()).rejects.toThrow('toBeHidden')
  } finally { await closeFixtureServer(server) }
})

test('matches exported text assertions when result elements contain script or style nodes', async ({ appWindow, electronApp }) => {
  let broken = false
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<html><title>Text checkpoint fixture</title><main><div id="result">Saved <span>${broken ? 'incorrectly' : 'successfully'}</span><script type="application/json">{"private":"fixture-script-canary"}</script><style>#result { color: green }</style></div></main></html>`)
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
    await expect(page.locator('#result')).toHaveText('Saved successfully')
    const initial = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    const report = await appWindow.evaluate(({ tabId, context }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, {
      context, selector: '#result', condition: 'text', text: 'Saved successfully', reviewed: true
    }), { tabId, context: initial.checkpointContext! })
    expect(report.steps.at(-1)?.expectation?.observedMatch).toBe(true)
    expect(JSON.stringify(report)).not.toContain('fixture-script-canary')
    await page.evaluate(() => document.querySelector('#result')!.append(document.createTextNode('x'.repeat(64001))))
    await expect(appWindow.evaluate(({ tabId, context }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, {
      context, selector: '#result', condition: 'text', text: 'Saved successfully', reviewed: true
    }), { tabId, context: initial.checkpointContext! })).rejects.toThrow('select a smaller target')
    const stopped = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', tabId), tabId)
    expect(stopped.steps).toEqual(report.steps)
    const code = formatReproAsPlaywright(stopped).replace(/^import .*\n/, '')
    const run = () => {
      let execution: Promise<void> | undefined
      const register = (_title: string, body: (context: { page: Page }) => Promise<void>) => { execution = body({ page }) }
      new Function('test', 'expect', code)(register, expect.configure({ timeout: 500 }))
      if (!execution) throw new Error('Generated test did not register')
      return execution
    }
    await run()
    broken = true
    await expect(run()).rejects.toThrow('toHaveText')
  } finally { await closeFixtureServer(server) }
})

test('rejects shadow-containing text checkpoints without changing the recording and exports a light-DOM alternative', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<html><title>Shadow checkpoint fixture</title><div id="result"><span id="safe">Saved successfully</span><div id="host"></div></div><script>document.querySelector("#host").attachShadow({ mode: "open" }).innerHTML = \'<span>Update failed</span><input value="private-shadow-canary">\';</script></html>')
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
    await expect(page.locator('css:light=#result')).toHaveText('Saved successfullyUpdate failed')
    const before = await page.evaluate(() => ({ light: document.querySelector('#result')!.outerHTML, shadow: document.querySelector('#host')!.shadowRoot!.innerHTML }))
    const initial = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    for (const selector of ['#result', '#host']) {
      await expect(appWindow.evaluate(({ tabId, context, selector }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, {
        context, selector, condition: 'text', text: 'Saved successfully', reviewed: true
      }), { tabId, context: initial.checkpointContext!, selector })).rejects.toThrow('without open shadow roots')
      const unchanged = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', tabId), tabId)
      expect(unchanged.steps).toEqual(initial.steps)
      expect(JSON.stringify(unchanged)).not.toContain('private-shadow-canary')
    }
    expect(await page.evaluate(() => ({ light: document.querySelector('#result')!.outerHTML, shadow: document.querySelector('#host')!.shadowRoot!.innerHTML }))).toEqual(before)
    const accepted = await appWindow.evaluate(({ tabId, context }) => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('checkpoint', tabId, {
      context, selector: '#safe', condition: 'text', text: 'Saved successfully', reviewed: true
    }), { tabId, context: initial.checkpointContext! })
    expect(accepted.steps.at(-1)?.expectation?.observedMatch).toBe(true)
    const stopped = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('stop', tabId), tabId)
    const code = formatReproAsPlaywright(stopped).replace(/^import .*\n/, '')
    let execution: Promise<void> | undefined
    const register = (_title: string, body: (context: { page: Page }) => Promise<void>) => { execution = body({ page }) }
    new Function('test', 'expect', code)(register, expect.configure({ timeout: 500 }))
    if (!execution) throw new Error('Generated test did not register')
    await execution
    expect(JSON.stringify(stopped) + code).not.toContain('private-shadow-canary')
  } finally { await closeFixtureServer(server) }
})
