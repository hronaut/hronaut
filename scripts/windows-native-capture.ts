import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { connectMcpWorkspace } from './mcp-workspace.js'

// An agent's browser_screenshot of its tab while the real Windows shell is visible, minimized, restored and hidden to
// the notification area, once with the tab behind the person's tab and once with it shown in the shell. After each
// change of window state the page repaints a top and a bottom marker in new colors, so each viewport and full-page
// image has to show this step's colors, not a frame kept from before. The window states come from Windows itself
// (IsIconic and IsWindowVisible), not from Electron's own report of them, and a capture must not show, restore or
// focus a Hronaut window or bring Hronaut to the foreground.

type Native = (action: string, label?: string, output?: string) => string
type Rgb = readonly [number, number, number]
type NativeWindowState = { minimized: boolean; visible: boolean; processVisibleWindows: number; foreground: number; foregroundIsHronaut: boolean }
type Capture = { width: number; height: number; top: Rgb; bottom: Rgb }
type WindowEvents = { focus: number; show: number; restore: number; created: number }
type StepName = 'visible' | 'minimized' | 'restored' | 'hidden-to-tray'
/** The agent tab's view: which window holds it, if any, its bounds and whether it is set visible. */
type TabViewState = { host: 'shell' | 'other' | null; visible: boolean | null; bounds: unknown; shellContentBounds: unknown }

const PLACEMENTS = ['background', 'shown'] as const
const STEPS: ReadonlyArray<{ name: StepName; top: Rgb; bottom: Rgb }> = [
  { name: 'visible', top: [255, 0, 0], bottom: [0, 255, 255] },
  { name: 'minimized', top: [0, 200, 0], bottom: [255, 0, 255] },
  { name: 'restored', top: [0, 0, 255], bottom: [255, 128, 0] },
  { name: 'hidden-to-tray', top: [255, 255, 0], bottom: [128, 0, 255] }
]
const MIDDLE: Rgb = [119, 119, 119]
const PAGE_HEIGHT = 2400
const MARKER_HEIGHT = 300
const CALL_TIMEOUT_MS = 30_000
const STATE_TIMEOUT_MS = 20_000
/** Window events a state change sends late are not the capture's. */
const SETTLE_MS = 750

const FIXTURE = `<!doctype html><title>Native capture fixture</title>
<style>html,body{margin:0}#top,#bottom{height:${MARKER_HEIGHT}px}#middle{height:${PAGE_HEIGHT - 2 * MARKER_HEIGHT}px;background:${css(MIDDLE)}}</style>
<div id="top"></div><div id="middle"></div><div id="bottom"></div>
<script>window.paint = (top, bottom) => {
  document.getElementById('top').style.background = top
  document.getElementById('bottom').style.background = bottom
  return getComputedStyle(document.getElementById('bottom')).backgroundColor
}</script>`

export async function checkCaptureAcrossWindowStates(options: {
  app: ElectronApplication
  shell: Page
  profile: string
  proof: string
  native: Native
  mcpPort: number
}): Promise<void> {
  const { app, shell, profile, proof, native, mcpPort } = options
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(FIXTURE)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const fixtureUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/capture`
  const authorization = `Bearer ${(await readFile(join(profile, 'mcp-token'), 'utf8')).trim()}`
  const client = new Client({ name: 'hronaut-windows-native-capture', version: '1.0.0' })
  const shellWindow = await (await app.browserWindow(shell)).evaluate(window => ({
    id: window.id,
    handle: window.getNativeWindowHandle().readBigInt64LE(0).toString()
  }))
  const evidence: unknown[] = []
  const save = (): Promise<void> => writeFile(join(proof, 'capture-states.json'), JSON.stringify(evidence, null, 2))
  let tabId: string | undefined
  try {
    // browser_evaluate repaints the page, so the agent gets the complete tool set.
    await shell.evaluate("window.hronautSettings.setMcpToolSet('complete')")
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization } })).ok
      } catch {
        return false
      }
    }, { timeout: 30_000 }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization } } }))
    await connectMcpWorkspace(client, 'Windows native capture', false)
    const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS }) as CallToolResult
      assert.notEqual(result.isError, true, `${name} failed: ${JSON.stringify(result.content).slice(0, 500)}`)
      return result
    }
    const opened = await call('browser_new_tab', { url: fixtureUrl, active: true })
    tabId = (JSON.parse(textOf(opened)) as { activeTabId: string }).activeTabId
    await call('browser_wait', { tabId, selector: '#bottom', state: 'attached' })

    const environment = await app.evaluate(({ screen }) => ({
      chrome: process.versions.chrome,
      session: process.env.SESSIONNAME ?? null,
      displays: screen.getAllDisplays().map(display => ({ size: display.size, scaleFactor: display.scaleFactor }))
    }))
    evidence.push({ shellHandle: shellWindow.handle, ...environment })
    await save()
    await countWindowEvents(app, shellWindow.id)
    const windowCount = (): Promise<number> => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    const baselineWindows = await windowCount()
    const nativeState = (): NativeWindowState => JSON.parse(native('window', shellWindow.handle)) as NativeWindowState
    const tabView = (): Promise<TabViewState> => viewOf(app, shellWindow.id, fixtureUrl)
    const shellState = (): Promise<{ activeTabId?: string; minimized: boolean; visible: boolean }> => Promise.all([
      shell.evaluate('window.hronaut.getState()') as Promise<{ activeTabId?: string }>,
      app.evaluate(({ BrowserWindow }, id) => {
        const window = BrowserWindow.fromId(id)
        return { minimized: window?.isMinimized() ?? false, visible: window?.isVisible() ?? false }
      }, shellWindow.id)
    ]).then(([browser, window]) => ({ activeTabId: browser.activeTabId, ...window }))

    for (const placement of PLACEMENTS) {
      if (placement === 'shown') {
        // The person shows the agent's tab, so a capture while the window is visible reads the shell's own view, and
        // one while it is minimized or in the tray moves that view to a temporary host and back.
        await shell.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
        await expect.poll(async () => (await shellState()).activeTabId, { timeout: STATE_TIMEOUT_MS }).toBe(tabId)
      }
      for (const [index, step] of STEPS.entries()) {
        const label = `${placement}-${index + 1}-${step.name}`
        await setWindowState(app, shellWindow.id, step.name)
        const expected = { minimized: step.name === 'minimized', visible: step.name !== 'hidden-to-tray' }
        try {
          await expect.poll(() => {
            const state = nativeState()
            return { minimized: state.minimized, visible: state.visible }
          }, { timeout: STATE_TIMEOUT_MS }).toEqual(expected)
        } catch (error) {
          // Coverage this desktop cannot give is reported as such, never as a pass. A helper that cannot read the
          // window at all fails here as itself.
          const observed = nativeState()
          native('screenshot', '', join(proof, `${label}-inconclusive.png`))
          evidence.push({ placement, step: step.name, status: 'inconclusive', expected, observed })
          await save()
          throw new Error(`Inconclusive: the shell window did not reach the native ${step.name} state on this desktop. ${String(error)}`)
        }
        await new Promise(resolve => setTimeout(resolve, SETTLE_MS))
        const before = nativeState()
        const shellBefore = await shellState()
        // The page is ready once its markers have the step's colors; the screenshot has to show them.
        const painted = await call('browser_evaluate', { tabId, script: `window.paint(${JSON.stringify(css(step.top))}, ${JSON.stringify(css(step.bottom))})` })
        assert.equal(textOf(painted).replaceAll('"', ''), css(step.bottom))
        await resetWindowEvents(app)
        const views: Record<string, TabViewState> = { beforeViewport: await tabView() }
        // Where the tab's view was when a capture failed, for the evidence.
        const screenshot = async (name: string, args: Record<string, unknown>): Promise<Capture> => {
          try {
            return await capture(app, proof, `${label}-${name}`, await call('browser_screenshot', { tabId, ...args }))
          } catch (error) {
            evidence.push({ placement, step: step.name, status: 'capture-failed', capture: name, views: { ...views, atFailure: await tabView() }, error: String(error) })
            await save()
            throw error
          }
        }
        const viewport = await screenshot('viewport', {})
        views.beforeFullPage = await tabView()
        const fullPage = await screenshot('full-page', { fullPage: true })
        views.afterFullPage = await tabView()
        const events = await windowEvents(app)
        const after = nativeState()
        const shellAfter = await shellState()
        // Temporary capture hosts are gone once the capture settles.
        const windowsLeft = await expect.poll(windowCount, { timeout: STATE_TIMEOUT_MS }).toBe(baselineWindows)
          .then(() => baselineWindows, windowCount)
        const checks: Record<string, boolean | null> = {
          stateBeforeCapture: before.minimized === expected.minimized && before.visible === expected.visible,
          viewportTopIsFresh: sameColor(viewport.top, step.top),
          viewportBottomIsMiddle: sameColor(viewport.bottom, MIDDLE),
          fullPageTopIsFresh: sameColor(fullPage.top, step.top),
          fullPageBottomIsFresh: sameColor(fullPage.bottom, step.bottom),
          fullPageTallerThanViewport: fullPage.height > viewport.height,
          windowStateKept: after.minimized === before.minimized && after.visible === before.visible
            && shellAfter.minimized === shellBefore.minimized && shellAfter.visible === shellBefore.visible,
          activeTabKept: shellAfter.activeTabId === shellBefore.activeTabId,
          noWindowShownRestoredOrFocused: events.focus === 0 && events.show === 0 && events.restore === 0,
          // Only meaningful when Hronaut did not have the foreground; another program may take it either way.
          foregroundNotTaken: before.foregroundIsHronaut ? null : !after.foregroundIsHronaut,
          temporaryWindowsClosed: windowsLeft === baselineWindows
        }
        evidence.push({
          placement, step: step.name, status: 'checked', expected: { top: step.top, bottom: step.bottom, middle: MIDDLE },
          nativeBefore: before, nativeAfter: after, shellBefore, shellAfter, foregroundChanged: after.foreground !== before.foreground,
          windowEvents: events, baselineWindows, windowsLeft, views, viewport, fullPage, checks
        })
        await save()
        for (const [check, passed] of Object.entries(checks)) {
          if (passed !== null) assert.equal(passed, true, `${label}: ${check} failed; see capture-states.json`)
        }
      }
    }
  } finally {
    await setWindowState(app, shellWindow.id, 'restored').catch(() => undefined)
    if (tabId) await client.callTool({ name: 'browser_close_tab', arguments: { tabId } }).catch(() => undefined)
    await client.close().catch(() => undefined)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

async function viewOf(app: ElectronApplication, shellId: number, url: string): Promise<TabViewState> {
  return await app.evaluate(({ BrowserWindow, WebContentsView }, { shellId, url }) => {
    const shell = BrowserWindow.fromId(shellId)
    for (const window of BrowserWindow.getAllWindows()) {
      const view = window.contentView.children.find(child => child instanceof WebContentsView && child.webContents.getURL() === url)
      if (view) return { host: window === shell ? 'shell' : 'other', visible: view.getVisible(), bounds: view.getBounds(), shellContentBounds: shell?.getContentBounds() ?? null }
    }
    return { host: null, visible: null, bounds: null, shellContentBounds: shell?.getContentBounds() ?? null }
  }, { shellId, url }) as TabViewState
}

/** Moves the shell window as a person would: restore, minimize, or close, which hides it to the notification area. */
async function setWindowState(app: ElectronApplication, id: number, name: StepName): Promise<void> {
  await app.evaluate(({ BrowserWindow }, { id, name }) => {
    const window = BrowserWindow.fromId(id)
    if (!window) throw new Error('The shell window closed')
    if (name === 'minimized') window.minimize()
    // With Hide in tray on, as it is by default, closing the window hides it.
    else if (name === 'hidden-to-tray') window.close()
    else {
      if (window.isMinimized()) window.restore()
      if (!window.isVisible()) window.show()
    }
  }, { id, name })
}

/** Counts, in main, focus, show and restore of the shell and focus or creation of any window. */
async function countWindowEvents(app: ElectronApplication, id: number): Promise<void> {
  await app.evaluate(({ app, BrowserWindow }, id) => {
    const scope = globalThis as typeof globalThis & { __captureWindowEvents?: WindowEvents }
    const events = scope.__captureWindowEvents = { focus: 0, show: 0, restore: 0, created: 0 }
    const window = BrowserWindow.fromId(id)!
    window.on('show', () => { events.show++ })
    window.on('restore', () => { events.restore++ })
    app.on('browser-window-focus', () => { events.focus++ })
    app.on('browser-window-created', () => { events.created++ })
  }, id)
}

async function resetWindowEvents(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const events = (globalThis as typeof globalThis & { __captureWindowEvents?: WindowEvents }).__captureWindowEvents!
    events.focus = 0; events.show = 0; events.restore = 0; events.created = 0
  })
}

function windowEvents(app: ElectronApplication): Promise<WindowEvents> {
  return app.evaluate(() => ({ ...(globalThis as typeof globalThis & { __captureWindowEvents?: WindowEvents }).__captureWindowEvents! }))
}

function textOf(result: CallToolResult): string {
  const part = result.content.find(item => item.type === 'text')
  return part?.type === 'text' ? part.text : ''
}

function css([red, green, blue]: Rgb): string {
  return `rgb(${red}, ${green}, ${blue})`
}

// Display color management can move a channel slightly; a kept frame from another step is far off in every case.
function sameColor(actual: Rgb, expected: Rgb): boolean {
  return actual.every((channel, index) => Math.abs(channel - expected[index]!) <= 24)
}

// Saves the synthetic image and reads its size and the colors near its top and bottom edges, in the middle.
async function capture(app: ElectronApplication, proof: string, name: string, result: CallToolResult): Promise<Capture> {
  const image = result.content.find(item => item.type === 'image')
  assert.ok(image?.type === 'image' && image.mimeType === 'image/png', `${name}: no PNG image was returned`)
  await writeFile(join(proof, `${name}.png`), Buffer.from(image.data, 'base64'))
  return await app.evaluate(({ nativeImage }, data) => {
    const picture = nativeImage.createFromBuffer(Buffer.from(data, 'base64'))
    const { width, height } = picture.getSize()
    const bitmap = picture.toBitmap()
    // Raw pixels are BGRA on Windows.
    const at = (y: number): [number, number, number] => {
      const offset = (Math.min(height - 1, Math.max(0, y)) * width + Math.floor(width / 2)) * 4
      return [bitmap[offset + 2]!, bitmap[offset + 1]!, bitmap[offset]!]
    }
    return { width, height, top: at(20), bottom: at(height - 21) }
  }, image.data)
}
