// The release gate on responsiveness (HRO-64): Hronaut keeps answering the person while four agents work, and its
// shell starts small. Run alone, after the Electron suite: npm run test:performance:headless (see CONTRIBUTING.md).
import { createServer, type Server } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication, Page } from '@playwright/test'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const PERSON_TABS = 12
const AGENTS = 4
const TABS_PER_AGENT = 4
const CLICKS = 40

// Each limit sits well above what a hosted CI runner measured and below what Hronaut measured before the HRO-64
// changes, so a run on a slow machine passes and a return of the old costs fails.
const LIMITS = {
  shellFirstPaintMs: 1_000,
  shellHeapMB: 12,
  clickToActiveTabP90Ms: 150,
  mainThreadBusyPercent: 80,
  mainEventLoopDelayP99Ms: 50,
  shellBusyPercent: 80,
  screenshotP50Ms: 400,
  snapshotP50Ms: 200,
  windowBytesPerAgentCallKB: 90
}

interface Percentiles { count: number; p50: number; p90: number; max: number }

function percentiles(values: number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (quantile: number) => sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))] ?? 0
  return { count: sorted.length, p50: Math.round(at(0.5)), p90: Math.round(at(0.9)), max: Math.round(sorted.at(-1) ?? 0) }
}

function toolText(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

/** A page as heavy as an ordinary website's: a favicon, images that arrive late, a long list of links and buttons. */
function sitePage(n: number): string {
  const images = Array.from({ length: 30 }, (_, i) => `<img src="/img/${n}/${i}.svg" width="24" height="24" alt="">`).join('')
  const rows = Array.from({ length: 300 }, (_, i) => `<li><a href="/page/${(n + i) % 50}">Item ${i} of page ${n}</a> <button>Act ${i}</button></li>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Page ${n}</title><link rel="icon" href="/favicon/${n}.svg">
<style>body{font-family:sans-serif;background:hsl(${(n * 47) % 360} 40% 96%)}</style></head>
<body><h1>Page ${n}</h1><form><input name="q" placeholder="Search"><button>Go</button></form>${images}<ul>${rows}</ul>
<script>setTimeout(() => { document.title = 'Page ${n} (ready)' }, 300)</script></body></html>`
}

function startSite(): Promise<{ server: Server; base: string }> {
  const server = createServer((request, response) => {
    const url = request.url ?? '/'
    const page = /^\/page\/(\d+)/.exec(url)
    if (page) {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(sitePage(Number(page[1])))
      return
    }
    const favicon = /^\/favicon\/(\d+)\.svg/.exec(url)
    if (favicon) {
      response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' })
      const hue = (Number(favicon[1]) * 47) % 360
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="hsl(${hue} 70% 50%)"/></svg>`)
      return
    }
    const image = /^\/img\/(\d+)\/(\d+)\.svg/.exec(url)
    if (image) {
      const color = (Number(image[2]) * 9973 % 0xffffff).toString(16).padStart(6, '0')
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' })
        response.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#${color}"/></svg>`)
      }, 20 + (Number(image[2]) % 7) * 15)
      return
    }
    response.writeHead(404)
    response.end()
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('The site has no port.'))
      else resolve({ server, base: `http://127.0.0.1:${address.port}` })
    })
  })
}

/** The shell's first paint and its heap after a full garbage collection, before the person opens anything. */
async function shellStart(electronApp: ElectronApplication, appWindow: Page) {
  await appWindow.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0)
  const firstPaintMs = await appWindow.evaluate(() => Math.round(performance.getEntriesByName('first-contentful-paint')[0]!.startTime))
  const heapBytes = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const shell = BrowserWindow.getAllWindows()[0]!.webContents
    const debug = shell.debugger
    const attached = debug.isAttached()
    if (!attached) debug.attach('1.3')
    try {
      await debug.sendCommand('HeapProfiler.collectGarbage')
      await debug.sendCommand('HeapProfiler.collectGarbage')
      return (await debug.sendCommand('Runtime.getHeapUsage') as { usedSize: number }).usedSize
    } finally {
      if (!attached) debug.detach()
    }
  })
  return { firstPaintMs, heapMB: Math.round(heapBytes / 1024 / 102.4) / 10 }
}

/**
 * The time main's own thread ran, from Linux's account of it, and how late main's event loop ran its timers.
 * The thread's time counts Chromium's work on it as well as JavaScript's.
 */
function startMainLoad(electronApp: ElectronApplication): Promise<void> {
  return electronApp.evaluate(() => {
    const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
    const { monitorEventLoopDelay } = process.getBuiltinModule('node:perf_hooks') as typeof import('node:perf_hooks')
    const threadTicks = () => {
      const fields = readFileSync(`/proc/self/task/${process.pid}/stat`, 'utf8').split(')').at(-1)!.trim().split(' ')
      return Number(fields[11]) + Number(fields[12])
    }
    const delay = monitorEventLoopDelay({ resolution: 10 })
    delay.enable()
    const started = { ticks: threadTicks(), at: performance.now() }
    ;(globalThis as Record<string, unknown>).__responsivenessMainLoad = () => {
      delay.disable()
      const wallMs = performance.now() - started.at
      // Linux counts a thread's time in ticks of 10 ms (USER_HZ is 100 on every architecture Hronaut builds for).
      const busyMs = (threadTicks() - started.ticks) * 10
      return { busyPercent: Math.round(100 * busyMs / wallMs), eventLoopDelayP99Ms: Math.round(delay.percentile(99) / 1e6) }
    }
  })
}

function stopMainLoad(electronApp: ElectronApplication): Promise<{ busyPercent: number; eventLoopDelayP99Ms: number }> {
  return electronApp.evaluate(() => {
    const stop = (globalThis as Record<string, unknown>).__responsivenessMainLoad as () => { busyPercent: number; eventLoopDelayP99Ms: number }
    delete (globalThis as Record<string, unknown>).__responsivenessMainLoad
    return stop()
  })
}

/** How long, from the pointer going down on a tab, until the shell paints that tab as the active one. */
async function clickTabs(appWindow: Page): Promise<number[]> {
  await appWindow.evaluate(() => {
    const record = { times: [] as number[] }
    ;(window as unknown as { __tabClicks: typeof record }).__tabClicks = record
    document.addEventListener('pointerdown', (event) => {
      const id = (event.target as Element | null)?.closest<HTMLElement>('[data-tab-id]')?.dataset.tabId
      if (!id) return
      const start = event.timeStamp
      const check = () => {
        if (document.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)?.dataset.activeTab === 'true') {
          requestAnimationFrame(() => record.times.push(performance.now() - start))
        } else {
          requestAnimationFrame(check)
        }
      }
      requestAnimationFrame(check)
    }, { capture: true })
  })
  const recorded = () => appWindow.evaluate(() => (window as unknown as { __tabClicks: { times: number[] } }).__tabClicks.times.length)
  const tabs = appWindow.locator('[role="tablist"] [data-tab-id]')
  const count = Math.min(await tabs.count(), PERSON_TABS)
  for (let i = 0; i < CLICKS; i += 1) {
    const target = tabs.nth((i * 5 + 1) % count)
    if (await target.getAttribute('data-active-tab') === 'true') continue
    const before = await recorded()
    await target.click()
    await expect.poll(recorded, { timeout: 15_000 }).toBeGreaterThan(before)
    // The pointer then rests on another tab, the way a person moves over the strip.
    await tabs.nth((i * 3) % count).hover()
    await appWindow.waitForTimeout(150)
  }
  return appWindow.evaluate(() => (window as unknown as { __tabClicks: { times: number[] } }).__tabClicks.times)
}

/** What Hronaut sends its own windows (the shell and the overlays), in bytes of JSON, while counting is on. */
function startCountingWindowMessages(electronApp: ElectronApplication): Promise<void> {
  return electronApp.evaluate(({ webContents }) => {
    const counted = { bytes: 0, restore: [] as (() => void)[] }
    for (const contents of webContents.getAllWebContents().filter((candidate) => candidate.getURL().startsWith('file:'))) {
      const send = contents.send
      contents.send = (channel: string, ...args: unknown[]) => {
        counted.bytes += channel.length + JSON.stringify(args).length
        send.call(contents, channel, ...args)
      }
      counted.restore.push(() => { contents.send = send })
    }
    ;(globalThis as Record<string, unknown>).__responsivenessWindowMessages = counted
  })
}

function stopCountingWindowMessages(electronApp: ElectronApplication): Promise<number> {
  return electronApp.evaluate(() => {
    const counted = (globalThis as Record<string, unknown>).__responsivenessWindowMessages as { bytes: number; restore: (() => void)[] }
    delete (globalThis as Record<string, unknown>).__responsivenessWindowMessages
    for (const restore of counted.restore) restore()
    return counted.bytes
  })
}

test('stays responsive to the person while four agents work', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  test.setTimeout(240_000)
  const start = await shellStart(electronApp, appWindow)
  const { server, base } = await startSite()
  const clients: Client[] = []
  const toolTimes: Record<string, number[]> = {}
  const toolErrors: string[] = []
  let calls = 0
  let stop = false
  let agents: Promise<void>[] = []
  try {
    for (let i = 0; i < PERSON_TABS; i += 1) {
      await appWindow.evaluate(`window.hronaut.newTab(${JSON.stringify({ url: `${base}/page/${i}`, active: i === 0 })})`)
    }
    await expect(appWindow.locator('[role="tablist"] [data-tab-id]')).toHaveCount(PERSON_TABS, { timeout: 30_000 })

    const agentTabs: string[][] = []
    for (let a = 0; a < AGENTS; a += 1) {
      const client = new Client({ name: `responsiveness-agent-${a}`, version: '1.0.0' })
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
      }))
      clients.push(client)
      await useMcpWorkspace(client, `Agent ${a + 1}`, false)
      let tabs: string[] = []
      for (let i = 0; i < TABS_PER_AGENT; i += 1) {
        const url = `${base}/page/${20 + a * TABS_PER_AGENT + i}`
        const opened = await client.callTool({ name: 'browser_new_tab', arguments: { url, active: false } }) as CallToolResult
        if (opened.isError) throw new Error(toolText(opened))
        tabs = (JSON.parse(toolText(opened)) as { tabs: { id: string }[] }).tabs.map((tab) => tab.id)
      }
      agentTabs.push(tabs)
    }

    const call = async (client: Client, name: string, args: Record<string, unknown>) => {
      const started = performance.now()
      const result = await client.callTool({ name, arguments: args }) as CallToolResult
      ;(toolTimes[name] ??= []).push(performance.now() - started)
      calls += 1
      if (result.isError) toolErrors.push(`${name}: ${toolText(result).slice(0, 300)}`)
    }
    // Each agent goes round its tabs: open another page, read it, take a screenshot of it.
    agents = clients.map(async (client, a) => {
      try {
        for (let round = 0; !stop; round += 1) {
          const tabId = agentTabs[a]![round % TABS_PER_AGENT]!
          await call(client, 'browser_navigate', { tabId, url: `${base}/page/${(a * 7 + round) % 50}` })
          await call(client, 'browser_snapshot', { tabId })
          await call(client, 'browser_screenshot', { tabId })
        }
      } catch (error) {
        toolErrors.push(`agent ${a + 1} stopped: ${String(error).slice(0, 300)}`)
      }
    })
    await appWindow.waitForTimeout(3_000)

    // While the person clicks tabs.
    for (const name of Object.keys(toolTimes)) toolTimes[name] = []
    const shell = await appWindow.context().newCDPSession(appWindow)
    await shell.send('Performance.enable')
    const shellTaskSeconds = async () => (await shell.send('Performance.getMetrics')).metrics.find((metric) => metric.name === 'TaskDuration')!.value
    const shellBefore = { task: await shellTaskSeconds(), at: performance.now() }
    await startMainLoad(electronApp)
    const clicks = percentiles(await clickTabs(appWindow))
    const main = await stopMainLoad(electronApp)
    const shellBusyPercent = Math.round(100 * 1000 * (await shellTaskSeconds() - shellBefore.task) / (performance.now() - shellBefore.at))
    await shell.detach()

    // Then, with nobody clicking, what the agents' work sends Hronaut's own windows.
    await startCountingWindowMessages(electronApp)
    const callsBefore = calls
    await appWindow.waitForTimeout(5_000)
    const windowBytes = await stopCountingWindowMessages(electronApp)
    const windowBytesPerAgentCallKB = Math.round(windowBytes / Math.max(1, calls - callsBefore) / 102.4) / 10

    stop = true
    await Promise.all(agents)
    const screenshots = percentiles(toolTimes.browser_screenshot ?? [])
    const snapshots = percentiles(toolTimes.browser_snapshot ?? [])
    const measured = {
      shellFirstPaintMs: start.firstPaintMs,
      shellHeapMB: start.heapMB,
      clickToActiveTabP90Ms: clicks.p90,
      mainThreadBusyPercent: main.busyPercent,
      mainEventLoopDelayP99Ms: main.eventLoopDelayP99Ms,
      shellBusyPercent,
      screenshotP50Ms: screenshots.p50,
      snapshotP50Ms: snapshots.p50,
      windowBytesPerAgentCallKB
    }
    const report = { measured, limits: LIMITS, clicks, screenshots, snapshots, agentCalls: calls }
    console.log(`Responsiveness: ${JSON.stringify(report)}`)
    await test.info().attach('responsiveness.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })

    expect(toolErrors, 'The agents\' tools answered without errors').toEqual([])
    expect(clicks.count, 'Every click on a tab was measured').toBeGreaterThanOrEqual(CLICKS / 2)
    for (const [name, limit] of Object.entries(LIMITS) as [keyof typeof LIMITS, number][]) {
      expect.soft(measured[name], `${name} stays at or under ${limit}`).toBeLessThanOrEqual(limit)
    }
  } finally {
    stop = true
    await Promise.allSettled(agents)
    await Promise.allSettled(clients.map((client) => client.close()))
    await closeFixtureServer(server)
  }
})
