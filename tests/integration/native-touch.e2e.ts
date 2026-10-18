import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'

interface TouchEventRecord {
  type: string
  trusted: boolean
  touches?: number
  x?: number | null
  y?: number | null
  pointerType?: string
}

interface TouchState {
  events: TouchEventRecord[]
  clicks: number
  slide: number
  carouselMoves: number
  dpr: number
  touchCapable: boolean
}

// A pad that records every touch and pointer event, and a carousel that only
// follows trusted touches, like the mobile carousel in Playwright #35774.
const PAGE = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Touch fixture</title>
<style>body { margin: 0 } #pad { position: absolute; left: 0; top: 0; width: 360px; height: 200px; background: #eee; touch-action: none }
#carousel { position: absolute; left: 0; top: 240px; width: 360px; height: 160px; overflow: hidden; background: #ddd; touch-action: pan-y }
#track { display: flex; width: 1080px; height: 100% } .slide { width: 360px; flex: none }</style>
<div id="pad"></div>
<div id="carousel"><div id="track"><div class="slide">1</div><div class="slide">2</div><div class="slide">3</div></div></div>
<script>
  const state = window.touchState = { events: [], clicks: 0, slide: 0, carouselMoves: 0 }
  const pad = document.querySelector('#pad')
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) pad.addEventListener(type, event => {
    const touch = event.changedTouches[0]
    state.events.push({ type, trusted: event.isTrusted, touches: event.touches.length, x: touch ? Math.round(touch.clientX) : null, y: touch ? Math.round(touch.clientY) : null })
  }, { passive: false })
  for (const type of ['pointerdown', 'pointerup', 'pointercancel']) pad.addEventListener(type, event => {
    state.events.push({ type, trusted: event.isTrusted, pointerType: event.pointerType })
  })
  pad.addEventListener('click', event => { if (event.isTrusted) state.clicks += 1 })
  const carousel = document.querySelector('#carousel')
  let startX = null
  carousel.addEventListener('touchstart', event => { if (event.isTrusted) startX = event.touches[0].clientX })
  carousel.addEventListener('touchmove', event => { if (event.isTrusted) state.carouselMoves += 1 })
  carousel.addEventListener('touchend', event => {
    if (!event.isTrusted || startX === null) return
    const dx = event.changedTouches[0].clientX - startX
    if (dx < -50) state.slide = Math.min(2, state.slide + 1)
    if (dx > 50) state.slide = Math.max(0, state.slide - 1)
    document.querySelector('#track').style.transform = 'translateX(' + (-360 * state.slide) + 'px)'
    startX = null
  })
</script>`

const TOUCH_VIEWPORT = { width: 390, height: 600, deviceScaleFactor: 2, mobile: true, touch: true, orientation: 'portrait' }

async function withTouchFixture(appWindow: Page, mcpPort: number, mcpToken: string, run: (fixture: {
  client: Client
  workspaceId: string
  tabId: string
  origin: string
  textOf: (result: CallToolResult) => string
  call: <T>(name: string, args: Record<string, unknown>) => Promise<T>
  emulateTouch: () => Promise<void>
  touchState: () => Promise<TouchState>
  resetState: () => Promise<unknown>
}) => Promise<void>): Promise<void> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(PAGE)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Page fixture did not expose a port')
  const client = new Client({ name: 'hronaut-touch-test', version: '1.0.0' })
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const textOf = (result: CallToolResult): string => result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const result = await client.callTool({ name, arguments: args }) as CallToolResult
      if (result.isError) throw new Error(textOf(result))
      return JSON.parse(textOf(result)) as T
    }
    const origin = `http://127.0.0.1:${address.port}`
    const workspaceId = (await call<{ id: string }>('browser_workspaces', { action: 'create', name: 'Touch gestures' })).id
    const tabId = (await call<{ activeTabId: string }>('browser_new_tab', { workspaceId, url: `${origin}/` })).activeTabId
    // Touch input waits for the page to paint, so the tab is shown.
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    const ready = await client.callTool({ name: 'browser_wait', arguments: { workspaceId, tabId, selector: '#carousel', state: 'visible' } }) as CallToolResult
    expect(ready.isError, textOf(ready)).not.toBe(true)
    const emulateTouch = async (): Promise<void> => {
      await call('browser_emulate', { workspaceId, tabId, viewport: TOUCH_VIEWPORT })
      // Touch support is read when the document loads.
      await call('browser_navigate', { workspaceId, tabId, url: `${origin}/` })
      const loaded = await client.callTool({ name: 'browser_wait', arguments: { workspaceId, tabId, selector: '#carousel', state: 'visible' } }) as CallToolResult
      expect(loaded.isError, textOf(loaded)).not.toBe(true)
    }
    await run({
      client, workspaceId, tabId, origin, textOf, call, emulateTouch,
      touchState: () => call<TouchState>('browser_evaluate', { workspaceId, tabId, script: "({ ...window.touchState, dpr: devicePixelRatio, touchCapable: 'ontouchstart' in window })" }),
      resetState: () => call('browser_evaluate', { workspaceId, tabId, script: 'JSON.stringify((window.touchState.events = [], window.touchState.clicks = 0, window.touchState.carouselMoves = 0, true))' })
    })
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
}

/** The fixture page's record, read in main so it works while an MCP call holds the workspace. */
function pageTouchState(electronApp: ElectronApplication, origin: string): Promise<TouchState | null> {
  return electronApp.evaluate(async ({ webContents }, prefix) => {
    const page = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(prefix))
    return page ? await page.executeJavaScript('window.touchState ?? null', true) as TouchState | null : null
  }, origin)
}

test('taps and swipes with trusted single-finger touch input at a non-default pixel ratio', async ({ appWindow, mcpPort, mcpToken }) => {
  // Verified on Linux with desktop Chromium touch emulation.
  test.skip(process.platform !== 'linux', 'Touch gestures are verified on Linux only')
  await withTouchFixture(appWindow, mcpPort, mcpToken, async ({ client, workspaceId, tabId, textOf, emulateTouch, touchState, resetState }) => {
    const touch = (args: Record<string, unknown>) => client.callTool({ name: 'browser_touch', arguments: { workspaceId, tabId, ...args } }) as Promise<CallToolResult>

    // Without touch emulation nothing is sent.
    const withoutEmulation = await touch({ gesture: 'tap', x: 100, y: 100 })
    expect(withoutEmulation.isError).toBe(true)
    expect(textOf(withoutEmulation)).toContain('touch emulation')
    expect((await touchState()).events).toEqual([])

    await emulateTouch()
    expect(await touchState()).toMatchObject({ dpr: 2, touchCapable: true })

    // A tap is one touchstart and one touchend, one touch pointer down and up, and one click.
    const tap = JSON.parse(textOf(await touch({ gesture: 'tap', x: 100.5, y: 120 })))
    expect(tap).toMatchObject({ status: 'DISPATCH_ACKNOWLEDGED', gesture: 'tap', x: 100.5, y: 120, contact: 'ENDED' })
    await expect.poll(async () => (await touchState()).clicks).toBe(1)
    const tapped = await touchState()
    expect(tapped.events.map(event => event.type).sort()).toEqual(['pointerdown', 'pointerup', 'touchend', 'touchstart'])
    expect(tapped.events.every(event => event.trusted)).toBe(true)
    expect(tapped.events.filter(event => event.type.startsWith('pointer')).every(event => event.pointerType === 'touch')).toBe(true)
    expect(tapped.events.find(event => event.type === 'touchstart')).toMatchObject({ touches: 1, x: 101, y: 120 })
    await resetState()

    // A swipe moves one finger in a straight line; the carousel advances one slide.
    const swipe = JSON.parse(textOf(await touch({ gesture: 'swipe', x: 300, y: 300, endX: 60, endY: 300, durationMs: 250 })))
    expect(swipe).toMatchObject({ status: 'DISPATCH_ACKNOWLEDGED', gesture: 'swipe', endX: 60, endY: 300, durationMs: 250, moves: 10, contact: 'ENDED' })
    const swiped = await touchState()
    expect(swiped.slide).toBe(1)
    expect(swiped.carouselMoves).toBeGreaterThan(0)
    expect(swiped.carouselMoves).toBeLessThanOrEqual(10)
    await resetState()

    // A swipe on the pad sends one contact throughout.
    await touch({ gesture: 'swipe', x: 40, y: 40, endX: 240, endY: 160 })
    const padSwipe = await touchState()
    expect(padSwipe.events.filter(event => event.type === 'touchstart')).toHaveLength(1)
    expect(padSwipe.events.filter(event => event.type === 'touchend')).toHaveLength(1)
    expect(padSwipe.events.filter(event => event.type === 'touchmove').every(event => event.touches === 1)).toBe(true)
    expect(padSwipe.events.filter(event => event.type === 'touchend')[0]).toMatchObject({ x: 240, y: 160 })
    await resetState()

    // Malformed gestures and points outside the visible viewport are rejected before any input.
    for (const args of [
      { gesture: 'tap', x: 10, y: 10, endX: 20, endY: 20 },
      { gesture: 'tap', x: 10, y: 10, durationMs: 100 },
      { gesture: 'swipe', x: 10, y: 10 },
      { gesture: 'swipe', x: 10, y: 10, endX: 10, endY: 10 },
      { gesture: 'swipe', x: 10, y: 10, endX: 100, endY: 10, durationMs: 10 },
      { gesture: 'swipe', x: 10, y: 10, endX: 100, endY: 10, durationMs: 2001 },
      { gesture: 'pinch', x: 10, y: 10 },
      { gesture: 'tap', x: 395, y: 10 },
      { gesture: 'swipe', x: 10, y: 10, endX: 10, endY: 605 },
      { gesture: 'tap', x: 10, y: 10, modifiers: ['Shift'] }
    ]) {
      const rejected = await touch(args)
      expect(rejected.isError, JSON.stringify(args)).toBe(true)
    }
    expect((await touchState()).events).toEqual([])

    // A page the person locked gets no touch input.
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, true)`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.humanInteractionLocked)`)).toBe(true)
    const locked = await touch({ gesture: 'tap', x: 100, y: 100 })
    expect(locked.isError).toBe(true)
    expect(textOf(locked)).toContain('unlocked')
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, false)`)
    expect((await touchState()).events).toEqual([])
  })
})

test('an interrupted swipe cancels its contact, and a fresh gesture works', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  test.skip(process.platform !== 'linux', 'Touch gestures are verified on Linux only')
  await withTouchFixture(appWindow, mcpPort, mcpToken, async ({ client, workspaceId, tabId, origin, textOf, call, emulateTouch, touchState, resetState }) => {
    const touch = (args: Record<string, unknown>) => client.callTool({ name: 'browser_touch', arguments: { workspaceId, tabId, ...args } }) as Promise<CallToolResult>
    await emulateTouch()
    expect((await touchState()).touchCapable).toBe(true)
    const started = async (): Promise<boolean> => (await pageTouchState(electronApp, origin))?.events.some(event => event.type === 'touchstart') ?? false

    // Pausing agents on the tab stops a swipe between moves; its contact is cancelled, never ended.
    const paused = touch({ gesture: 'swipe', x: 40, y: 40, endX: 240, endY: 160, durationMs: 2000 })
    await expect.poll(started).toBe(true)
    await appWindow.evaluate(`window.hronaut.setTabAgentPaused(${JSON.stringify(tabId)}, true)`)
    const stopped = await paused
    expect(stopped.isError).toBe(true)
    const outcome = JSON.parse(textOf(stopped))
    expect(outcome).toMatchObject({ status: 'OUTCOME_UNKNOWN', reason: 'TOUCH_GESTURE_UNCERTAIN', retrySafe: false, effects: 'possible', contact: 'CANCELLED' })
    expect(outcome.moves).toBeLessThan(10)
    const interrupted = await pageTouchState(electronApp, origin)
    expect(interrupted!.events.filter(event => event.type === 'touchstart')).toHaveLength(1)
    expect(interrupted!.events.filter(event => event.type === 'touchcancel')).toHaveLength(1)
    expect(interrupted!.events.filter(event => event.type === 'touchend')).toEqual([])
    await appWindow.evaluate(`window.hronaut.setTabAgentPaused(${JSON.stringify(tabId)}, false)`)
    await resetState()

    // A fresh tap starts a new contact.
    const fresh = JSON.parse(textOf(await touch({ gesture: 'tap', x: 100, y: 100 })))
    expect(fresh).toMatchObject({ status: 'DISPATCH_ACKNOWLEDGED', contact: 'ENDED' })
    const afterFresh = await touchState()
    expect(afterFresh.events.filter(event => event.type === 'touchstart')).toEqual([expect.objectContaining({ touches: 1, x: 100, y: 100 })])
    expect(afterFresh.events.filter(event => event.type === 'touchend')).toHaveLength(1)
    await resetState()

    // Locking the page mid-swipe stops it. The agent's own contact is still cancelled,
    // since the lock's input barrier waits for the gesture, and the lock then applies.
    const lockedState = () => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.humanInteractionLocked)`)
    const lockedSwipe = touch({ gesture: 'swipe', x: 40, y: 40, endX: 240, endY: 160, durationMs: 2000 })
    await expect.poll(started).toBe(true)
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, true)`)
    const lockStopped = await lockedSwipe
    expect(lockStopped.isError).toBe(true)
    expect(JSON.parse(textOf(lockStopped))).toMatchObject({ status: 'OUTCOME_UNKNOWN', contact: 'CANCELLED' })
    await expect.poll(lockedState).toBe(true)
    const lockInterrupted = await pageTouchState(electronApp, origin)
    expect(lockInterrupted!.events.filter(event => event.type === 'touchcancel')).toHaveLength(1)
    expect(lockInterrupted!.events.filter(event => event.type === 'touchend')).toEqual([])
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, false)`)
    await expect.poll(lockedState).toBe(false)
    await resetState()

    // A navigation during a swipe stops it and the contact is still lifted, so the
    // replacement page takes a fresh gesture with one finger, not two.
    const navigated = touch({ gesture: 'swipe', x: 40, y: 40, endX: 240, endY: 160, durationMs: 2000 })
    await expect.poll(started).toBe(true)
    await electronApp.evaluate(async ({ webContents }, prefix) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(prefix))!
      await page.executeJavaScript(`location.href = ${JSON.stringify(`${prefix}/replacement`)}; void 0`, true)
    }, origin)
    const replaced = await navigated
    expect(replaced.isError).toBe(true)
    expect(JSON.parse(textOf(replaced))).toMatchObject({ status: 'OUTCOME_UNKNOWN', contact: expect.stringMatching(/^(CANCELLED|CLEARED)$/) })
    await expect.poll(() => call<string>('browser_evaluate', { workspaceId, tabId, script: 'JSON.stringify(location.href)' })).toBe(`${origin}/replacement`)
    const wait = await client.callTool({ name: 'browser_wait', arguments: { workspaceId, tabId, selector: '#carousel', state: 'visible' } }) as CallToolResult
    expect(wait.isError, textOf(wait)).not.toBe(true)
    const afterNavigation = JSON.parse(textOf(await touch({ gesture: 'tap', x: 100, y: 100 })))
    expect(afterNavigation).toMatchObject({ status: 'DISPATCH_ACKNOWLEDGED', contact: 'ENDED' })
    const replacement = await touchState()
    expect(replacement.events.filter(event => event.type === 'touchstart')).toEqual([expect.objectContaining({ touches: 1, x: 100, y: 100 })])
    expect(replacement.events.filter(event => event.type === 'touchend')).toEqual([expect.objectContaining({ touches: 0 })])
    expect(replacement.clicks).toBe(1)
  })
})
