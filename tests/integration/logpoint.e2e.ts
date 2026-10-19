import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication, Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'
import type { LogpointReport, LogpointScriptsReport } from '../../src/shared/logpoint.js'

const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>

// esbuild's unminified bundle of src/cart.ts (with src/a/format.ts and src/b/format.ts) and its source map.
// The original lines used below: cart.ts 8 `let sum = 0`, 10 `sum += ...`, 12 `const discount`, 13 `state.orders += 1`,
// 14 `return sum - discount`, 20 `acc = (acc + i) % 7919` in a loop, and 26 `w.state = state` at the top level.
const BUNDLE = '(() => {\n  // src/a/format.ts\n  function formatA(value) {\n    return `A${value}`;\n  }\n\n  // src/b/format.ts\n  function formatB(value) {\n    return `B${value}`;\n  }\n\n  // src/cart.ts\n  var state = { orders: 0, note: "n" };\n  function total(items) {\n    let sum = 0;\n    for (const item of items) {\n      sum += item.price * item.qty;\n    }\n    const discount = sum > 100 ? 10 : 0;\n    state.orders += 1;\n    return sum - discount;\n  }\n  function spin(n) {\n    let acc = 0;\n    for (let i = 0; i < n; i++) {\n      acc = (acc + i) % 7919;\n    }\n    return acc;\n  }\n  var w = window;\n  w.state = state;\n  w.checkout = (items) => total(items);\n  w.spin = (n) => spin(n);\n  w.labels = (value) => [formatA(value), formatB(value)];\n  w.hitDebugger = () => {\n    debugger;\n    w.afterDebugger = 1;\n  };\n  w.beats = 0;\n  setInterval(() => {\n    w.beats = w.beats + 1;\n  }, 20);\n})();\n//# sourceMappingURL=bundle.js.map\n'
const MAP = {
  version: 3,
  sources: ['../src/a/format.ts', '../src/b/format.ts', '../src/cart.ts'],
  mappings: ';;AAAO,WAAS,QAAQ,OAAuB;AAC7C,WAAO,IAAI,KAAK;AAAA,EAClB;;;ACFO,WAAS,QAAQ,OAAuB;AAC7C,WAAO,IAAI,KAAK;AAAA,EAClB;;;ACEA,MAAM,QAAQ,EAAE,QAAQ,GAAG,MAAM,IAAI;AAE9B,WAAS,MAAM,OAAuB;AAC3C,QAAI,MAAM;AACV,eAAW,QAAQ,OAAO;AACxB,aAAO,KAAK,QAAQ,KAAK;AAAA,IAC3B;AACA,UAAM,WAAW,MAAM,MAAM,KAAK;AAClC,UAAM,UAAU;AAChB,WAAO,MAAM;AAAA,EACf;AAEA,WAAS,KAAK,GAAmB;AAC/B,QAAI,MAAM;AACV,aAAS,IAAI,GAAG,IAAI,GAAG,KAAK;AAC1B,aAAO,MAAM,KAAK;AAAA,IACpB;AACA,WAAO;AAAA,EACT;AAEA,MAAM,IAAI;AACV,IAAE,QAAQ;AACV,IAAE,WAAW,CAAC,UAAkB,MAAM,KAAK;AAC3C,IAAE,OAAO,CAAC,MAAc,KAAK,CAAC;AAC9B,IAAE,SAAS,CAAC,UAAkB,CAAC,QAAQ,KAAK,GAAG,QAAQ,KAAK,CAAC;AAC7D,IAAE,cAAc,MAAM;AAAE;AAAU,MAAE,gBAAgB;AAAA,EAAE;AACtD,IAAE,QAAQ;AACV,cAAY,MAAM;AAAE,MAAE,QAAS,EAAE,QAAmB;AAAA,EAAE,GAAG,EAAE;',
  names: [],
  // Never returned: only source names leave the map.
  sourcesContent: ['// SOURCE-CONTENT-CANARY a', '// SOURCE-CONTENT-CANARY b', '// SOURCE-CONTENT-CANARY cart']
}
const INLINE_MAP = Buffer.from(JSON.stringify({ version: 3, sources: ['inline-src.ts'], mappings: 'AAAA', names: [] })).toString('base64')
const SCRIPTS: Record<string, string> = {
  '/inline.js': `window.inline = 1\n//# sourceMappingURL=data:application/json;base64,${INLINE_MAP}\n`,
  '/missing.js': 'window.missing = 1\n//# sourceMappingURL=missing.js.map\n',
  '/plain.js': 'window.plain = 1\n'
}
// The private value is made by script at load, so it is in no response body or cache entry.
const PAGE = `<!doctype html><title>Cart</title><h1>Cart</h1>
<script>window.secretCanary = ['private', 'logpoint', crypto.randomUUID()].join('-')</script>
<script src="/bundle.js"></script><script src="/inline.js"></script><script src="/missing.js"></script><script src="/plain.js"></script>
<iframe id="frame" src="/frame"></iframe>`
const FRAME = '<!doctype html><script src="/bundle.js"></script>'

interface Site { server: Server; origin: string; pageUrl: string; changeBundle(changed: boolean): void }

async function site(): Promise<Site> {
  let changed = false
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname
    response.setHeader('cache-control', 'no-store')
    if (path === '/bundle.js') {
      response.setHeader('content-type', 'text/javascript')
      // Another build at the same address: same code, different bytes.
      response.end(changed ? BUNDLE.replace('w.beats = 0;', 'w.beats = 0; w.build = 2;') : BUNDLE)
    } else if (path === '/bundle.js.map') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(MAP))
    } else if (SCRIPTS[path]) {
      response.setHeader('content-type', 'text/javascript')
      response.end(SCRIPTS[path])
    } else if (path.endsWith('.map')) {
      response.statusCode = 404
      response.end()
    } else {
      response.setHeader('content-type', 'text/html')
      response.end(path === '/frame' ? FRAME : PAGE)
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return { server, origin, pageUrl: `${origin}/app`, changeBundle: value => { changed = value } }
}

async function logpoint(client: Client, tabId: string, args: Record<string, unknown>): Promise<LogpointReport> {
  const result = await call(client, 'browser_logpoint', { tabId, ...args })
  expect(result.isError, text(result)).not.toBe(true)
  return JSON.parse(text(result)) as LogpointReport
}

async function refused(client: Client, tabId: string, args: Record<string, unknown>): Promise<string> {
  const result = await call(client, 'browser_logpoint', { tabId, ...args })
  expect(result.isError, text(result)).toBe(true)
  return text(result)
}

/** Runs page code from the main process, outside Hronaut's debugger session; a page that does not answer fails the test. */
async function run(electronApp: ElectronApplication, pageUrl: string, script: string): Promise<unknown> {
  return electronApp.evaluate(async ({ webContents }, { pageUrl, script }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)
    if (!page) throw new Error(`No page at ${pageUrl}`)
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('The page did not answer within 5 seconds')), 5_000))
    return Promise.race([page.mainFrame.executeJavaScript(script), timeout])
  }, { pageUrl, script })
}

function page(electronApp: ElectronApplication, pageUrl: string, action: 'crash' | 'reload'): Promise<void> {
  return electronApp.evaluate(({ webContents }, { pageUrl, action }) => {
    const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === pageUrl)
    if (!contents) throw new Error(`No page at ${pageUrl}`)
    if (action === 'crash') contents.forcefullyCrashRenderer()
    else contents.reload()
  }, { pageUrl, action })
}

async function reloaded(electronApp: ElectronApplication, pageUrl: string): Promise<void> {
  const before = await run(electronApp, pageUrl, 'window.secretCanary').catch(() => undefined)
  await page(electronApp, pageUrl, 'reload')
  await expect.poll(() => run(electronApp, pageUrl, 'typeof checkout === "function" && window.secretCanary').catch(() => false), { timeout: 10_000 })
    .not.toBe(before)
  await expect.poll(() => run(electronApp, pageUrl, 'typeof checkout').catch(() => 'loading'), { timeout: 10_000 }).toBe('function')
}

/** Listeners on the page's debugger session and renderer exits: logpoints that removed themselves leave none behind. */
function listeners(electronApp: ElectronApplication, pageUrl: string): Promise<number[]> {
  return electronApp.evaluate(({ webContents }, pageUrl) => {
    const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === pageUrl)
    if (!contents) throw new Error(`No page at ${pageUrl}`)
    return [contents.debugger.listenerCount('message'), contents.listenerCount('render-process-gone')]
  }, pageUrl)
}

/** The page keeps running: its 20 ms heartbeat advances. */
async function expectRunning(electronApp: ElectronApplication, pageUrl: string): Promise<void> {
  const before = await run(electronApp, pageUrl, 'window.beats') as number
  await expect.poll(async () => (await run(electronApp, pageUrl, 'window.beats') as number) - before, { timeout: 5_000 }).toBeGreaterThan(5)
}

async function ended(client: Client, tabId: string): Promise<LogpointReport> {
  await expect.poll(async () => (await logpoint(client, tabId, { action: 'get' })).status, { timeout: 5_000 }).not.toBe('armed')
  return logpoint(client, tabId, { action: 'get' })
}

/** Every file under the profile that contains the text, read up to 32 MB each. */
async function filesContaining(directory: string, needle: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    const size = (await stat(path).catch(() => undefined))?.size
    if (size === undefined || size > 32 * 1024 * 1024) continue
    const content = await readFile(path).catch(() => undefined)
    if (content?.includes(needle)) found.push(path)
  }
  return found
}

async function open(client: Client, tabId: string): Promise<Site> {
  const fixture = await site()
  const navigated = await call(client, 'browser_navigate', { tabId, url: fixture.pageUrl })
  expect(navigated.isError, text(navigated)).not.toBe(true)
  return fixture
}

const ORDER = '[{ price: 10, qty: 2 }, { price: 50, qty: 3 }]'

test('lists scripts with their sources and records source-mapped values without changing the page', async ({ capabilities, electronApp, profileDirectory }) => {
  const { client, tabId } = capabilities
  const { server, origin, pageUrl } = await open(client, tabId)
  try {
    const canary = await run(electronApp, pageUrl, 'window.secretCanary') as string
    const listing = await call(client, 'browser_logpoint', { tabId, action: 'scripts' })
    expect(listing.isError, text(listing)).not.toBe(true)
    expect(text(listing)).not.toContain('SOURCE-CONTENT-CANARY')
    const scripts = (JSON.parse(text(listing)) as LogpointScriptsReport).scripts
    // The bundle is listed once although the frame runs it too, and the document's inline script has its address.
    expect(scripts).toEqual([
      { url: `${origin}/app`, sourceMap: 'none' },
      { url: `${origin}/bundle.js`, sourceMap: 'loaded', sources: MAP.sources },
      { url: `${origin}/inline.js`, sourceMap: 'loaded', sources: ['inline-src.ts'] },
      { url: `${origin}/missing.js`, sourceMap: 'unavailable', sourceMapProblem: 'fetch-failed' },
      { url: `${origin}/plain.js`, sourceMap: 'none' }
    ])
    // Listing leaves the Debugger domain off: a debugger statement does not pause the page.
    expect(await run(electronApp, pageUrl, 'hitDebugger(); window.afterDebugger')).toBe(1)

    const added = await logpoint(client, tabId, {
      action: 'add',
      maxHits: 3,
      probes: [
        { source: 'src/cart.ts', line: 8, expression: 'window.secretCanary' },
        { source: 'cart.ts', line: 10, expression: 'sum' },
        { source: 'src/cart.ts', line: 12, expression: '"x".repeat(5000)' },
        { source: 'src/cart.ts', line: 13, expression: '[sum, discount]' },
        { source: 'src/cart.ts', line: 14, expression: 'state.orders = 99' }
      ]
    })
    expect(added).toMatchObject({ status: 'armed', origin })
    expect(added.probes[1]).toMatchObject({
      id: 'p2',
      requested: { source: 'cart.ts', line: 10 },
      resolved: { url: `${origin}/bundle.js`, line: 17, original: { source: '../src/cart.ts', line: 10 } },
      state: 'armed',
      records: []
    })

    expect(await run(electronApp, pageUrl, `checkout(${ORDER})`)).toBe(160)
    const first = await logpoint(client, tabId, { action: 'get' })
    expect(first.probes.map(probe => probe.records.length)).toEqual([1, 2, 1, 1, 1])
    expect(first.probes[0]!.records[0]!.value).toEqual({ type: 'string', value: canary })
    expect(first.probes[1]!.records.map(record => record.value)).toEqual([{ type: 'number', value: 0 }, { type: 'number', value: 20 }])
    expect(first.probes[2]!.records[0]!.value).toEqual({ type: 'string', value: 'x'.repeat(200), chars: 5000 })
    expect(first.probes[3]!.records[0]!.value).toMatchObject({
      type: 'object', subtype: 'array', description: 'Array(2)',
      properties: [{ name: '0', type: 'number', value: '170' }, { name: '1', type: 'number', value: '10' }]
    })
    // Chromium refused the assignment: the page's state is unchanged.
    expect(first.probes[4]!.records[0]).toMatchObject({ error: { kind: 'side-effect' } })
    expect(await run(electronApp, pageUrl, 'state.orders')).toBe(1)

    // The same bundle in a frame of the page is resumed without a record, and its hits count toward maxHits:
    // the loop's logpoint reaches its limit at the frame's first pass.
    expect(await run(electronApp, pageUrl, `document.getElementById('frame').contentWindow.checkout(${ORDER})`)).toBe(160)
    const framed = await logpoint(client, tabId, { action: 'get' })
    expect(framed.probes.map(probe => [probe.records.length, probe.otherFrameHits, probe.missedHits, probe.state])).toEqual([
      [1, 1, 0, 'armed'], [2, 1, 0, 'complete'], [1, 1, 0, 'armed'], [1, 1, 0, 'armed'], [1, 1, 0, 'armed']
    ])
    expect(await run(electronApp, pageUrl, 'hitDebugger(); window.afterDebugger')).toBe(1)

    // A logpoint stops at its hit limit, and the set ends once every logpoint is complete.
    expect(await run(electronApp, pageUrl, `checkout(${ORDER}); checkout(${ORDER})`)).toBe(160)
    const complete = await ended(client, tabId)
    expect(complete).toMatchObject({ status: 'ended', ended: { reason: 'complete' } })
    expect(complete.probes.map(probe => [probe.state, probe.records.length, probe.otherFrameHits])).toEqual(Array(5).fill(['complete', 2, 1]))
    expect(complete.probes[1]!.records.map(record => record.value)).toEqual([0, 20].map(value => ({ type: 'number', value })))
    expect(await run(electronApp, pageUrl, `checkout(${ORDER})`)).toBe(160)

    // A busy loop pauses the page only up to the hit limit.
    await logpoint(client, tabId, { action: 'add', maxHits: 5, probes: [{ source: 'src/cart.ts', line: 20, expression: 'acc' }] })
    const started = Date.now()
    expect(await run(electronApp, pageUrl, 'spin(1000000)')).toBeGreaterThanOrEqual(0)
    expect(Date.now() - started).toBeLessThan(5_000)
    const loop = await ended(client, tabId)
    expect(loop).toMatchObject({ ended: { reason: 'complete' } })
    expect(loop.probes[0]!.records.map(record => record.value)).toEqual([0, 0, 1, 3, 6].map(value => ({ type: 'number', value })))
    await expectRunning(electronApp, pageUrl)

    // Values stay in memory: no log or profile file holds them.
    const logs = await call(client, 'browser_diagnostic_logs', { tabId })
    expect(text(logs)).not.toContain(canary)
    await expect.poll(() => filesContaining(profileDirectory, pageUrl), { timeout: 10_000 }).not.toEqual([])
    expect(await filesContaining(profileDirectory, canary)).toEqual([])
  } finally {
    await call(client, 'browser_logpoint', { tabId, action: 'remove' }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})

test('says why a logpoint cannot be set, and removing one stops its records', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const { server, origin, pageUrl } = await open(client, tabId)
  try {
    const add = (probe: Record<string, unknown>) => refused(client, tabId, { action: 'add', probes: [{ expression: 'sum', ...probe }] })
    expect(await add({ source: 'format.ts', line: 2 })).toContain('2 sources match')
    expect(await add({ source: 'nothing.ts', line: 2 })).toContain('no source map of the top-level page that loaded lists that source')
    expect(await add({ source: 'src/cart.ts', line: 3 })).toContain('no code maps to that line')
    expect(await add({ url: `${origin}/nope.js`, line: 2 })).toContain('no script of the top-level page is at that url')
    expect(await add({ source: 'src/cart.ts', line: 10, expression: '' })).toMatch(/expression/i)
    expect(await refused(client, tabId, { action: 'get', maxHits: 3 })).toContain('only for action add')
    expect(await refused(client, tabId, {
      action: 'add', probes: [{ source: 'src/cart.ts', line: 10, expression: 'sum' }, { source: 'cart.ts', line: 10, expression: 'item' }]
    })).toContain('same location as another')
    // A refused add leaves nothing armed, and the page is not paused by a debugger statement.
    expect(await logpoint(client, tabId, { action: 'get' })).toMatchObject({ status: 'idle', probes: [] })
    expect(await run(electronApp, pageUrl, 'hitDebugger(); window.afterDebugger')).toBe(1)

    // A script address and a line in the code the browser runs work without a source map.
    const byUrl = await logpoint(client, tabId, { action: 'add', probes: [{ url: `${origin}/bundle.js?build=1`, line: 17, expression: 'sum' }] })
    expect(byUrl.probes[0]).toMatchObject({ resolved: { url: `${origin}/bundle.js`, line: 17 } })
    expect(byUrl.probes[0]!.resolved.original).toBeUndefined()
    expect(await run(electronApp, pageUrl, `checkout(${ORDER})`)).toBe(160)
    expect((await logpoint(client, tabId, { action: 'get' })).probes[0]!.records).toHaveLength(2)
    const removed = await logpoint(client, tabId, { action: 'remove' })
    expect(removed).toMatchObject({ status: 'ended', ended: { reason: 'removed' }, probes: [{ state: 'ended' }] })
    expect(await run(electronApp, pageUrl, `checkout(${ORDER})`)).toBe(160)
    expect((await logpoint(client, tabId, { action: 'get' })).probes[0]!.records).toHaveLength(2)
    expect(await run(electronApp, pageUrl, 'hitDebugger(); window.afterDebugger')).toBe(1)
  } finally {
    await call(client, 'browser_logpoint', { tabId, action: 'remove' }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})

test('logpoints survive a reload of the same bundle and end on another bundle\'s origin, a person, a crash and Developer Tools', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId } = capabilities
  const fixture = await open(client, tabId)
  const { server, origin, pageUrl } = fixture
  try {
    const idleListeners = await listeners(electronApp, pageUrl)
    await logpoint(client, tabId, { action: 'add', probes: [{ source: 'src/cart.ts', line: 26, expression: 'typeof state' }] })
    await expect(appWindow.getByTestId('logpoints-pill')).toHaveAccessibleName(`Stop the agent's logpoints on ${origin}`)
    // Top-level code already ran; a reload of the same bundle runs it again with the logpoint in place.
    expect((await logpoint(client, tabId, { action: 'get' })).probes[0]!.records).toHaveLength(0)
    await reloaded(electronApp, pageUrl)
    await expect.poll(async () => (await logpoint(client, tabId, { action: 'get' })).probes[0]!.records.length, { timeout: 5_000 }).toBe(1)
    expect((await logpoint(client, tabId, { action: 'get' })).probes[0]!.records[0]!.value).toEqual({ type: 'string', value: 'object' })
    // Another build at the same address never hits, and the logpoint says so.
    fixture.changeBundle(true)
    await reloaded(electronApp, pageUrl)
    await expect.poll(async () => (await logpoint(client, tabId, { action: 'get' })).probes[0]!.state, { timeout: 5_000 }).toBe('stale')
    expect((await logpoint(client, tabId, { action: 'get' })).probes[0]!.records).toHaveLength(1)
    fixture.changeBundle(false)
    await reloaded(electronApp, pageUrl)
    await expect.poll(async () => (await logpoint(client, tabId, { action: 'get' })).probes[0]!.records.length, { timeout: 5_000 }).toBe(2)
    expect((await logpoint(client, tabId, { action: 'get' })).probes[0]!.state).toBe('armed')

    // An armed set keeps its tab awake, even when another tab is in front, and holds the debugger session.
    const otherTab = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${origin}/front`)}, active: true }).then((state) => state.activeTabId)`) as string
    try {
      await expect(appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(tabId)}, true)`)).rejects.toThrow('A tab with armed logpoints stays active.')
      expect(await logpoint(client, tabId, { action: 'get' })).toMatchObject({ status: 'armed' })
    } finally {
      await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(otherTab)})`)
    }
    const coverage = await call(client, 'browser_code_coverage', { tabId, action: 'start', reload: false })
    expect(text(coverage)).toContain('Remove the logpoints before recording code coverage')
    const mutation = await call(client, 'browser_dom_mutation_source', { tabId, action: 'arm', selector: 'h1', kind: 'attribute-modified' })
    expect(text(mutation)).toContain('Remove the logpoints before capturing a DOM mutation source')

    // The person stops them from the address bar.
    await appWindow.getByTestId('logpoints-pill').click()
    await expect(appWindow.getByTestId('logpoints-pill')).toHaveCount(0)
    expect(await ended(client, tabId)).toMatchObject({ status: 'ended', ended: { reason: 'person-stopped' }, probes: [{ state: 'ended' }] })
    await expect.poll(() => listeners(electronApp, pageUrl), { timeout: 5_000 }).toEqual(idleListeners)

    const armed = await call(client, 'browser_dom_mutation_source', { tabId, action: 'arm', selector: 'h1', kind: 'attribute-modified' })
    expect(armed.isError, text(armed)).not.toBe(true)
    expect(await refused(client, tabId, { action: 'add', probes: [{ source: 'src/cart.ts', line: 10, expression: 'sum' }] })).toContain('Cancel the DOM mutation source capture')
    await call(client, 'browser_dom_mutation_source', { tabId, action: 'cancel' })

    // A person using the page ends them.
    await logpoint(client, tabId, { action: 'add', probes: [{ source: 'src/cart.ts', line: 10, expression: 'sum' }] })
    await electronApp.evaluate(({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)!
      page.sendInputEvent({ type: 'mouseDown', x: 5, y: 5, button: 'left', clickCount: 1 })
      page.sendInputEvent({ type: 'mouseUp', x: 5, y: 5, button: 'left', clickCount: 1 })
    }, pageUrl)
    expect(await ended(client, tabId)).toMatchObject({ ended: { reason: 'authority-changed' } })

    // A renderer crash ends them, and the reloaded page is not left with a breakpoint or a paused debugger.
    await logpoint(client, tabId, { action: 'add', probes: [{ source: 'src/cart.ts', line: 10, expression: 'sum' }] })
    await page(electronApp, pageUrl, 'crash')
    expect(await ended(client, tabId)).toMatchObject({ ended: { reason: 'renderer-gone' } })
    await page(electronApp, pageUrl, 'reload')
    await expect.poll(() => run(electronApp, pageUrl, 'typeof hitDebugger').catch(() => 'loading'), { timeout: 10_000 }).toBe('function')
    expect(await run(electronApp, pageUrl, `checkout(${ORDER}); hitDebugger(); window.afterDebugger`)).toBe(1)
    await expectRunning(electronApp, pageUrl)
    await expect.poll(() => listeners(electronApp, pageUrl), { timeout: 5_000 }).toEqual(idleListeners)
    expect((await logpoint(client, tabId, { action: 'get' })).probes[0]!.records).toHaveLength(0)

    await logpoint(client, tabId, { action: 'add', probes: [{ source: 'src/cart.ts', line: 10, expression: 'sum' }] })
    await toggleDevTools(appWindow, tabId, true)
    expect(await ended(client, tabId)).toMatchObject({ ended: { reason: 'devtools-opened' } })
    expect(await refused(client, tabId, { action: 'add', probes: [{ source: 'src/cart.ts', line: 10, expression: 'sum' }] })).toContain('Developer Tools')
    await toggleDevTools(appWindow, tabId, false)
    await expectRunning(electronApp, pageUrl)

    // Leaving the origin ends them; the same path on another origin is another site.
    await logpoint(client, tabId, { action: 'add', probes: [{ source: 'src/cart.ts', line: 10, expression: 'sum' }] })
    const elsewhere = pageUrl.replace('127.0.0.1', 'localhost')
    const navigated = await call(client, 'browser_navigate', { tabId, url: elsewhere })
    expect(navigated.isError, text(navigated)).not.toBe(true)
    expect(await ended(client, tabId)).toMatchObject({ ended: { reason: 'origin-left' } })
    expect(await run(electronApp, elsewhere, `checkout(${ORDER}); hitDebugger(); window.afterDebugger`)).toBe(1)
  } finally {
    await call(client, 'browser_logpoint', { tabId, action: 'remove' }).catch(() => undefined)
    await call(client, 'browser_dom_mutation_source', { tabId, action: 'cancel' }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})

async function toggleDevTools(appWindow: Page, tabId: string, opened: boolean): Promise<void> {
  expect(await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(tabId)})`)).toBe(opened)
}
