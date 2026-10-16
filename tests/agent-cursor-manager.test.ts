import { afterEach, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'
import type { AgentPointerIdentity } from '../src/main/browser/page-scripts.js'

const CLAUDE: AgentPointerIdentity = { name: 'Claude Code', fill: '#2aa198', ink: '#111318' }

type PointerManager = Pick<BrowserTabsManager, 'screenshot' | 'savePdf'> & {
  captureVisual(tab: unknown, settleMs: number): Promise<{ png: Buffer }>
  showAgentPointer(webContents: unknown, point: { x: number; y: number }, effect: 'click', options?: { agent?: AgentPointerIdentity }): Promise<void>
}

function fixture(showAgentCursor?: boolean, answer: () => Promise<unknown> = async () => true) {
  const order: string[] = []
  const scripts: string[] = []
  const webContents = {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: vi.fn(async (world: number, sources: Array<{ code: string }>) => {
      order.push(`world ${world}`)
      scripts.push(sources[0]!.code)
      return answer()
    }),
    capturePage: vi.fn(async () => {
      order.push('capture')
      return {
        isEmpty: () => false,
        getSize: () => ({ width: 1, height: 1 }),
        toPNG: () => Buffer.from('png'),
        toBitmap: () => Buffer.alloc(4)
      }
    }),
    getURL: () => 'https://shop.example/checkout',
    printToPDF: vi.fn(async () => {
      order.push('print')
      return Buffer.from('%PDF')
    }),
    on: vi.fn(),
    removeListener: vi.fn()
  }
  const tab = { id: 'tab-1', title: 'Checkout', navigationGeneration: 1, webContents }
  const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
    options: showAgentCursor === undefined ? {} : { getShowAgentCursor: () => showAgentCursor },
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    mcpTabGroups: new Map(),
    inspectionPermissions: new Map(),
    destroyed: false,
    withRenderableTab: (_tab: unknown, run: () => Promise<unknown>) => run(),
    writeUniqueDownload: async (filename: string) => `/downloads/${filename}`,
    snapshotDeltaContext: () => ({ tabId: tab.id, workspaceId: null, navigationGeneration: 1, observationGeneration: 0, humanInteractionGeneration: 0, snapshotFormatVersion: 1 })
  }) as unknown as PointerManager
  return { manager, tab, webContents, order, scripts }
}

afterEach(() => {
  vi.useRealTimers()
})

it('draws the agent\'s named cursor in its own world, and nothing while agent cursors are off', async () => {
  const on = fixture()
  await on.manager.showAgentPointer(on.webContents, { x: 10, y: 20 }, 'click', { agent: CLAUDE })
  expect(on.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce()
  expect(on.webContents.executeJavaScriptInIsolatedWorld.mock.calls[0]?.[0]).toBe(ISOLATED_WORLDS.agentPointer)
  expect(on.scripts[0]).toContain('"name":"Claude Code"')
  expect(on.scripts[0]).toContain('#2aa198')

  const off = fixture(false)
  await off.manager.showAgentPointer(off.webContents, { x: 10, y: 20 }, 'click', { agent: CLAUDE })
  expect(off.webContents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
})

it('takes an agent\'s cursor off the page before capturing a screenshot for an agent', async () => {
  const { manager, order, scripts } = fixture(true)
  const shot = await manager.screenshot({ tabId: 'tab-1' })
  expect(shot.mimeType).toBe('image/png')
  expect(order).toEqual([`world ${ISOLATED_WORLDS.agentPointer}`, 'capture'])
  expect(scripts[0]).toContain('[data-hronaut-agent-pointer]')
})

it('captures anyway when the page does not answer, after a moment', async () => {
  vi.useFakeTimers()
  const { manager, order } = fixture(true, () => new Promise(() => undefined))
  const shot = manager.screenshot({ tabId: 'tab-1' })
  await vi.advanceTimersByTimeAsync(299)
  expect(order).toEqual([`world ${ISOLATED_WORLDS.agentPointer}`])
  await vi.advanceTimersByTimeAsync(1)
  await expect(shot).resolves.toMatchObject({ mimeType: 'image/png' })
  expect(order).toEqual([`world ${ISOLATED_WORLDS.agentPointer}`, 'capture'])
})

it('takes an agent\'s cursor off the page before printing it to PDF, since it would show on every page', async () => {
  const { manager, order, scripts } = fixture(true)
  await expect(manager.savePdf({ tabId: 'tab-1' })).resolves.toMatchObject({ bytes: 4 })
  expect(order).toEqual([`world ${ISOLATED_WORLDS.agentPointer}`, 'print'])
  expect(scripts[0]).toContain('[data-hronaut-agent-pointer]')
})

it('takes an agent\'s cursor off the page before a visual comparison capture', async () => {
  const { manager, tab, order } = fixture(true)
  await expect(manager.captureVisual(tab, 0)).resolves.toMatchObject({ png: Buffer.from('png') })
  expect(order).toEqual([`world ${ISOLATED_WORLDS.agentPointer}`, 'capture'])
})
