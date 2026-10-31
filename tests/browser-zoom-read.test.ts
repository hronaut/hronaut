import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { mcpCapabilityOperationClass } from '../src/main/mcp/capability-classification.js'
import { registerBrowserZoom } from '../src/main/mcp/tools/browser-zoom/index.js'

type ZoomCall = (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>

const TAB_ID = '01900000-0000-7000-8000-000000000001'

/** browser_zoom as registered, over one tab whose page the person zoomed to 150%. */
function zoomTool() {
  const page = { getZoomFactor: vi.fn(() => 1.5), setZoomFactor: vi.fn() }
  const tab = { id: TAB_ID, webContents: page, nativeInputEnvironmentGeneration: 0 }
  let shape: z.ZodRawShape | undefined
  let call: ZoomCall | undefined
  registerBrowserZoom({
    manager: { tabs: new Map([[tab.id, tab]]), activeTabId: tab.id },
    tabTool: (_name: string, callback: ZoomCall) => callback,
    registerWorkspaceTool: (_name: string, config: { inputSchema: z.ZodRawShape }, callback: ZoomCall) => {
      shape = config.inputSchema
      call = callback
    }
  } as never)
  const run = async (input: Record<string, unknown>): Promise<unknown> =>
    JSON.parse((await call!(z.object(shape!).parse(input))).content[0]!.text)
  return { page, run }
}

// An agent that called browser_zoom to see a tab's zoom, as its description offered, without naming an action, reset
// the zoom the person had chosen for the site, in every tab of that site and across restarts.
describe('browser_zoom without an action', () => {
  it('reads the tab\'s zoom and leaves it as the person set it', async () => {
    const { page, run } = zoomTool()
    await expect(run({ tabId: TAB_ID })).resolves.toEqual({ tabId: TAB_ID, zoomPercent: 150, zoomIsolated: false })
    await expect(run({ tabId: TAB_ID, action: 'get' })).resolves.toEqual({ tabId: TAB_ID, zoomPercent: 150, zoomIsolated: false })
    expect(page.setZoomFactor).not.toHaveBeenCalled()
  })

  it('counts as a read, which a read-only access profile allows, while the other actions change the browser', () => {
    expect(mcpCapabilityOperationClass('browser_zoom', {})).toBe('read')
    expect(mcpCapabilityOperationClass('browser_zoom', { action: 'get' })).toBe('read')
    for (const action of ['in', 'out', 'reset', 'set']) expect(mcpCapabilityOperationClass('browser_zoom', { action, percent: 125 })).toBe('browser-state')
  })
})
