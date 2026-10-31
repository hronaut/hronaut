import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it, vi } from 'vitest'
import { PrintDialogOpenError } from '../src/main/browser/print-dialog-guard.js'
import { WebsiteDialogOpenError } from '../src/main/browser/website-dialog-guard.js'
import { WebsiteDialogChangedError } from '../src/main/browser/website-dialogs/website-dialogs.js'
import { McpHttpServer } from '../src/main/mcp/server.js'

// The fake browser below stubs the functions its tool calls go through; these reach its stubs.
vi.mock('../src/main/browser/workspace-continuity/workspace-continuity.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-continuity/workspace-continuity.js')>(),
  beginWorkspaceContinuityAction: (browser: { beginWorkspaceContinuityAction: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.beginWorkspaceContinuityAction(...args),
  requireWorkspaceContinuityDispatch: (browser: { requireWorkspaceContinuityDispatch: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.requireWorkspaceContinuityDispatch(...args),
  suspendWorkspaceContinuity: (browser: { suspendWorkspaceContinuity: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.suspendWorkspaceContinuity(...args)
}))
vi.mock('../src/main/browser/agent-page-actions/click.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/agent-page-actions/click.js')>(),
  click: (browser: { click: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.click(...args)
}))
vi.mock('../src/main/browser/website-dialogs/website-dialogs.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/website-dialogs/website-dialogs.js')>(),
  handleDialog: (browser: { handleDialog: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.handleDialog(...args)
}))
vi.mock('../src/main/browser/page-snapshots/page-snapshots.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/page-snapshots/page-snapshots.js')>(),
  findSnapshot: (browser: { findSnapshot: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.findSnapshot(...args)
}))
vi.mock('../src/main/browser/live-region-recorder/browser-live-region-recorder.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/live-region-recorder/browser-live-region-recorder.js')>(),
  liveRegion: (browser: { liveRegion: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.liveRegion(...args)
}))
vi.mock('../src/main/browser/workspace-scope/workspace-scope.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-scope/workspace-scope.js')>(),
  requireTabInMcpGroup: (browser: { requireTabInMcpGroup: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.requireTabInMcpGroup(...args),
  getMcpGroupState: (browser: { getMcpGroupState: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.getMcpGroupState(...args),
  tabBelongsToMcpGroup: (browser: { tabBelongsToMcpGroup: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.tabBelongsToMcpGroup(...args)
}))
vi.mock('../src/main/browser/mcp-tab-groups/create-mcp-tab-group.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/mcp-tab-groups/create-mcp-tab-group.js')>(),
  createMcpTabGroup: (browser: { createMcpTabGroup: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.createMcpTabGroup(...args)
}))
vi.mock('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js')>(),
  listMcpTabGroups: (browser: { listMcpTabGroups: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.listMcpTabGroups(...args),
  requireMcpTabGroup: (browser: { requireMcpTabGroup: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.requireMcpTabGroup(...args)
}))
// A fake browser that stubs no pause answers has no paused or taken-over tab.
vi.mock('../src/main/browser/agent-pause/agent-pause.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/agent-pause/agent-pause.js')>(),
  isTabAgentPaused: (browser: { isTabAgentPaused?: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.isTabAgentPaused?.(...args) ?? false,
  hasPausedAgentTab: (browser: { hasPausedAgentTab?: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.hasPausedAgentTab?.(...args) ?? false,
  isTabTakenOver: (browser: { isTabTakenOver?: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.isTabTakenOver?.(...args) ?? false
}))

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
const tabId = '01912345-6790-7abc-8def-0123456789ab'

const TOOL_CALLS = {
  browser_click: { selector: '#delete' },
  browser_find: { query: 'Delete' },
  browser_live_region: { action: 'get' },
  browser_dialog: { action: 'accept', dialogId: '5f0c8a1e-2b3d-4e6f-8a9b-0c1d2e3f4a5b' }
}

/**
 * Calls a tool whose page call fails with this error, on a tab that shows this website dialog; with loseAccess, the
 * person turns off agent access to the workspace while the call runs.
 */
async function callStoppedBy(error: Error, tool: keyof typeof TOOL_CALLS, dialog?: { id?: string; type: string; message: string }, loseAccess = false) {
  const workspace = { id: workspaceId, name: 'Dialogs', agentAccess: true, contextClass: 'standard' }
  const manager = {
    suspendWorkspaceContinuity: vi.fn(() => false), requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace), listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]), listSavedTabGroups: vi.fn(() => []),
    isWorkspaceAgentAccessible: vi.fn(() => true), mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace), requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true), wakeTab: vi.fn(async () => {}),
    click: vi.fn(async () => {
      if (loseAccess) manager.isWorkspaceAgentAccessible.mockReturnValue(false)
      throw error
    }),
    findSnapshot: vi.fn(async () => { throw error }),
    liveRegion: vi.fn(async () => { throw error }),
    handleDialog: vi.fn(async () => { throw error }),
    getMcpGroupState: vi.fn(() => ({
      activeTabId: tabId,
      tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0,
        ...(dialog ? { dialog: { ...dialog, url: 'https://example.test/' } } : {}) }],
      mcpTabGroups: [workspace]
    }))
  }
  const auditStatuses: unknown[] = []
  const auditReceipts = {
    isRecording: vi.fn(() => true),
    execute: vi.fn(async (_workspace: string, action: {
      operation: () => Promise<CallToolResult>
      classifyErrorResult?: (result: CallToolResult) => unknown
    }) => {
      const result = await action.operation()
      // What the audit receipt records as the action's outcome.
      auditStatuses.push(result.isError ? action.classifyErrorResult?.(result) ?? 'failed' : 'succeeded')
      return result
    })
  }
  const activityEvents = vi.fn()
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'complete', auditReceipts: auditReceipts as never,
    onTabActivity: activityEvents, showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const client = new Client({ name: 'dialogs', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    expect((await call('browser_workspaces', { action: 'create', name: 'Dialogs' })).isError).not.toBe(true)
    const result = await call(tool, { workspaceId, tabId, ...TOOL_CALLS[tool] })
    const activities = activityEvents.mock.calls.map(([activity]) => activity).filter(activity => activity.toolName === tool && activity.phase !== 'started')
    const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
    return { result, text, activity: activities[0]?.result, auditStatuses }
  } finally {
    await client.close()
    await server.stop()
  }
}

// A click run in the page whose handler opened a confirm was reported as a plain failure, in its result, the tab's
// activity and the audit receipt, though the click had happened and its handler went on once the confirm was answered.
describe('an agent\'s action that a page\'s dialog stops after it reached the page', () => {
  it('reports a click that opened a website confirm as having unknown effects, naming the confirm', async () => {
    const { result, text, activity, auditStatuses } = await callStoppedBy(new WebsiteDialogOpenError(true), 'browser_click', { type: 'confirm', message: 'Delete it?' })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({
      status: 'OUTCOME_UNKNOWN', reason: 'WEBSITE_DIALOG_OPENED', dispatch: 'dispatched', effects: 'possible', retrySafe: false
    })
    expect(String(result.structuredContent?.nextAction)).toContain('browser_dialog')
    expect(text).toContain('The page now shows a website confirm: "Delete it?"')
    expect(activity).toMatchObject({ outcome: 'outcome-unknown', dispatch: 'dispatched', effects: 'possible' })
    expect(auditStatuses).toEqual(['outcome-unknown'])
  })

  it('reports a click that opened the page\'s print dialog the same way', async () => {
    const { result, activity, auditStatuses } = await callStoppedBy(new PrintDialogOpenError(true), 'browser_click')
    expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', reason: 'PRINT_DIALOG_OPENED', retrySafe: false })
    expect(String(result.structuredContent?.nextAction)).toContain('Ask the person to print or cancel')
    expect(activity).toMatchObject({ outcome: 'outcome-unknown' })
    expect(auditStatuses).toEqual(['outcome-unknown'])
  })

  it('keeps an action refused before it reached the page, and a read a dialog stopped, as they were', async () => {
    const refused = await callStoppedBy(new WebsiteDialogOpenError(false), 'browser_click', { type: 'alert', message: 'Saved' })
    expect(refused.result.isError).toBe(true)
    expect(refused.result.structuredContent?.status).not.toBe('OUTCOME_UNKNOWN')
    expect(refused.text).toContain('nothing was sent to it')
    expect(refused.activity).toMatchObject({ outcome: 'failed' })

    const read = await callStoppedBy(new WebsiteDialogOpenError(true), 'browser_find', { type: 'alert', message: 'Saved' })
    expect(read.result.isError).toBe(true)
    expect(read.result.structuredContent?.status).not.toBe('OUTCOME_UNKNOWN')
    expect(read.text).toContain('The page opened a website dialog during this action')
    expect(read.activity).toMatchObject({ outcome: 'failed', effects: 'none' })
  })

  // A read action of a tool that also changes things, such as a live region's get, changes nothing a dialog could stop.
  it('keeps a read action of a tool that also makes changes a plain error', async () => {
    const { result, text } = await callStoppedBy(new WebsiteDialogOpenError(true), 'browser_live_region', { type: 'alert', message: 'Saved' })
    expect(result.isError).toBe(true)
    expect(result.structuredContent?.status).not.toBe('OUTCOME_UNKNOWN')
    expect(text).toContain('The page opened a website dialog during this action')
  })

  // The dialog's message is page content, which an agent that lost the workspace during its call must not receive.
  it('leaves out the dialog\'s message when the agent lost access to the workspace during the call', async () => {
    const { result } = await callStoppedBy(new WebsiteDialogOpenError(true), 'browser_click', { type: 'confirm', message: 'Delete invoice 4471?' }, true)
    expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', reason: 'WEBSITE_DIALOG_OPENED', retrySafe: false })
    expect(JSON.stringify(result)).not.toContain('invoice 4471')
  })
})

// The agent read a confirm, the person answered it, and the page asked another. The agent's answer to the first was
// refused, but the refusal read as a failure that may have answered something.
describe('an agent\'s answer to a website dialog the tab no longer shows', () => {
  it('reports that nothing was answered and names the dialog the tab shows now', async () => {
    const shown = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
    const { result, text, activity, auditStatuses } = await callStoppedBy(new WebsiteDialogChangedError(), 'browser_dialog',
      { id: shown, type: 'confirm', message: 'Delete the draft?' })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({
      status: 'NOT_DISPATCHED', reason: 'DIALOG_CHANGED', dispatch: 'not-dispatched', effects: 'none', retrySafe: false
    })
    expect(text).toContain(`answer it with browser_dialog and dialogId "${shown}"`)
    expect(activity).toMatchObject({ outcome: 'failed', dispatch: 'not-dispatched', effects: 'none' })
    expect(auditStatuses).toEqual(['failed'])
  })
})
