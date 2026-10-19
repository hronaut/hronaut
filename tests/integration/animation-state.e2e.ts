import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'
import type { BrowserAnimationState } from '../../src/shared/animation-state.js'

const PAGE = `<!doctype html><title>Animations</title>
<style>
@keyframes private-keyframes-name { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
#css { animation: private-keyframes-name 1s linear infinite }
#delayed { animation: private-keyframes-name 2s linear 60s 1 }
#paused { animation: private-keyframes-name 1s linear infinite paused }
#trans { transition: opacity 30s linear; opacity: 1 }
#scroll { animation: private-keyframes-name linear; animation-timeline: scroll() }
#finite { animation: private-keyframes-name 200ms linear 1 forwards }
#clobbered { animation: private-keyframes-name 1s linear infinite }
#bar { animation: private-keyframes-name 1s linear infinite }
body { height: 3000px }
</style>
<div id="css">a</div><div id="delayed">b</div><div id="paused">c</div><div id="trans">d</div><div id="waapi">e</div>
<div id="scroll">f</div><div id="many">g</div><div id="none">h</div><div id="finite">i</div><div id="forever">j</div><input id="field">
<!-- Named elements that shadow the registry, the document's querySelectorAll and the form's own node fields. -->
<div id="hronaut.animationState"></div><img name="querySelectorAll" alt="">
<form id="clobbered"><input name="isConnected"><input name="getRootNode"></form><span id="ticker">0</span>
<div id="bar" role="progressbar" aria-valuenow="0"></div>
<script>
const transition = document.getElementById('trans'); transition.getBoundingClientRect(); setTimeout(() => { transition.style.opacity = '0' }, 30)
document.getElementById('waapi').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 3000, iterations: Infinity, id: 'private-anim-id' })
document.getElementById('forever').animate([{ opacity: 0 }, { opacity: 1 }], { duration: Infinity })
// A counter beside the animations, and a progress bar's own attribute, change every frame.
const ticker = document.getElementById('ticker'), bar = document.getElementById('bar')
const tick = () => { ticker.textContent = String(Number(ticker.textContent) + 1); bar.setAttribute('aria-valuenow', ticker.textContent); requestAnimationFrame(tick) }; requestAnimationFrame(tick)
window.makeMany = (n) => { const el = document.getElementById('many'); for (let i = 0; i < n; i++) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100000 + i }); return n }
// After this, any call into a page-defined replacement counts a hit.
window.hostile = () => {
  window.hits = 0
  const hit = () => { window.hits++ }
  Element.prototype.getAnimations = function () { hit(); return [] }
  Document.prototype.getAnimations = function () { hit(); return [] }
  for (const C of [Animation, KeyframeEffect, AnimationEffect, CSSAnimation, CSSTransition, AnimationTimeline, DocumentTimeline]) {
    for (const key of Object.getOwnPropertyNames(C.prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(C.prototype, key)
      if (descriptor && descriptor.get) Object.defineProperty(C.prototype, key, { get() { hit(); return 'hostile' }, configurable: true })
      else if (descriptor && typeof descriptor.value === 'function' && key !== 'constructor') C.prototype[key] = function () { hit(); return 'hostile' }
    }
  }
  Object.defineProperty(document, 'timeline', { get() { hit(); return null } })
  Object.defineProperty(Object.prototype, 'toJSON', { get() { hit(); return undefined }, configurable: true })
  Array.prototype[Symbol.iterator] = function* () { hit() }
  Array.prototype.slice = function () { hit(); return [] }
  document.querySelectorAll = function () { hit(); return [] }
  return 'armed'
}
</script>`

async function site(): Promise<{ server: Server; pageUrl: string }> {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html')
    response.end(PAGE)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, pageUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/animations` }
}

const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>

async function state(client: Client, tabId: string, selector: string): Promise<BrowserAnimationState> {
  const result = await call(client, 'browser_animation_state', { tabId, selector })
  expect(result.isError, text(result)).not.toBe(true)
  return JSON.parse(text(result)) as BrowserAnimationState
}

/** Runs page code in the main world from the main process. */
async function run(electronApp: ElectronApplication, pageUrl: string, script: string): Promise<unknown> {
  return electronApp.evaluate(async ({ webContents }, { pageUrl, script }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)
    if (!page) throw new Error(`No page at ${pageUrl}`)
    return page.mainFrame.executeJavaScript(script)
  }, { pageUrl, script })
}

test('reads CSS animations, transitions and Web Animations from native state without calling page overrides or changing the page', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId } = capabilities
  const { server, pageUrl } = await site()
  try {
    const navigated = await call(client, 'browser_navigate', { tabId, url: pageUrl })
    expect(navigated.isError, text(navigated)).not.toBe(true)
    await expect.poll(() => run(electronApp, pageUrl, 'document.getElementById("trans").getAnimations().length')).toBe(1)
    await expect.poll(() => run(electronApp, pageUrl, 'document.getElementById("finite").getAnimations()[0].playState')).toBe('finished')
    await run(electronApp, pageUrl, 'scrollTo(0, 120); document.getElementById("field").focus(); 1')
    const activeTab = await appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')
    expect(await run(electronApp, pageUrl, 'hostile()')).toBe('armed')
    const markupScript = `document.documentElement.outerHTML.replace(/<span id="ticker">\\d+<\\/span>/, '').replace(/aria-valuenow="\\d+"/, '')`
    const markup = await run(electronApp, pageUrl, markupScript)

    const css = await state(client, tabId, '#css')
    expect(css).toMatchObject({ count: 1, omitted: { unsupportedTimeline: 0, unsupportedEffect: 0, beyondLimit: 0, notExamined: 0 } })
    expect(css.animations[0]).toMatchObject({
      index: 1, kind: 'css-animation', playState: 'running', pending: false, playbackRate: 1, phase: 'active',
      durationMs: 1000, iterations: 'infinite', activeDurationMs: 'infinite', endTimeMs: 'infinite', direction: 'normal', fill: 'none',
      currentTimeMs: expect.any(Number), startTimeMs: expect.any(Number), progress: expect.any(Number)
    })
    expect((await state(client, tabId, '#delayed')).animations[0]).toMatchObject({ kind: 'css-animation', playState: 'running', phase: 'before', delayMs: 60_000, progress: null, currentIteration: null })
    const paused = await state(client, tabId, '#paused')
    expect(paused.animations[0]).toMatchObject({ kind: 'css-animation', playState: 'paused', startTimeMs: null, currentTimeMs: 0 })
    expect((await state(client, tabId, '#trans')).animations[0]).toMatchObject({ kind: 'css-transition', playState: 'running', phase: 'active', durationMs: 30_000, iterations: 1 })
    expect((await state(client, tabId, '#waapi')).animations[0]).toMatchObject({ kind: 'web-animation', playState: 'running', durationMs: 3000, iterations: 'infinite', fill: 'none' })
    expect((await state(client, tabId, '#finite')).animations[0]).toMatchObject({ playState: 'finished', phase: 'after', progress: 1, fill: 'forwards' })
    // A scroll-driven animation is counted but none of its fields are read.
    expect(await state(client, tabId, '#scroll')).toMatchObject({ count: 1, animations: [], omitted: { unsupportedTimeline: 1 } })
    expect(await state(client, tabId, '#none')).toMatchObject({ count: 0, animations: [] })
    // An infinite duration is reported, and named elements cannot shadow what the reading uses.
    expect((await state(client, tabId, '#forever')).animations[0]).toMatchObject({ durationMs: 'infinite', activeDurationMs: 'infinite', phase: 'active' })
    expect((await state(client, tabId, '#clobbered')).animations[0]).toMatchObject({ kind: 'css-animation', playState: 'running' })
    // A progress bar that updates its own attributes every frame is still read and published.
    expect((await state(client, tabId, '#bar')).animations[0]).toMatchObject({ kind: 'css-animation', playState: 'running' })

    // Repeated readings: the running animation advances and the paused one holds still.
    const later = await state(client, tabId, '#css')
    expect(later.animations[0]!.currentTimeMs! > css.animations[0]!.currentTimeMs!).toBe(true)
    expect((await state(client, tabId, '#paused')).animations[0]!.currentTimeMs).toBe(paused.animations[0]!.currentTimeMs)

    expect(await run(electronApp, pageUrl, 'window.hits')).toBe(0)
    expect(await run(electronApp, pageUrl, markupScript)).toBe(markup)
    expect(JSON.stringify([css, later, paused])).not.toMatch(/private-(keyframes-name|anim-id)|hostile/)
    expect(await run(electronApp, pageUrl, '[document.activeElement && document.activeElement.id, Math.round(scrollY)]')).toEqual(['field', 120])
    expect(await appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(activeTab)
  } finally {
    await closeFixtureServer(server)
  }
})

test('bounds what it examines and returns, and refuses missing, ambiguous and invalid targets and refs', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const { server, pageUrl } = await site()
  try {
    await call(client, 'browser_navigate', { tabId, url: pageUrl })
    expect(await run(electronApp, pageUrl, 'makeMany(1000)')).toBe(1000)
    const many = await state(client, tabId, '#many')
    expect(many).toMatchObject({ count: 1000, omitted: { unsupportedTimeline: 0, unsupportedEffect: 0, beyondLimit: 180, notExamined: 800 } })
    expect(many.animations).toHaveLength(20)
    expect(many.animations.map(({ index }) => index)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1))
    expect(JSON.stringify(many).length).toBeLessThan(16_384)

    for (const [selector, message] of [
      ['#missing', 'exactly one element'],
      ['div', 'exactly one element'],
      ['!!', 'valid CSS selector']
    ] as const) {
      const refused = await call(client, 'browser_animation_state', { tabId, selector })
      expect(refused.isError, selector).toBe(true)
      expect(text(refused)).toContain(message)
    }
    const byRef = await call(client, 'browser_animation_state', { tabId, selector: '#css', ref: 'e1' })
    expect(byRef.isError).toBe(true)
  } finally {
    await closeFixtureServer(server)
  }
})
