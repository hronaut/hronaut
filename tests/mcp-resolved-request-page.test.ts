import { describe, expect, it, vi } from 'vitest'
import type { BrowserState } from '../src/shared/types.js'
import { createWorkspaceNotices } from '../src/main/mcp/workspace-notices.js'
import { resolvedRequestPage } from '../src/main/mcp/tools/browser-user-attention/resolved-request-page.js'

// An agent whose attention request the person resolved reads the page of its tab with the answer, as it may read it.

vi.mock('../src/main/browser/workspace-scope/workspace-scope.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-scope/workspace-scope.js')>(),
  getMcpGroupState: (browser: { state: () => BrowserState }) => browser.state()
}))
vi.mock('../src/main/browser/page-snapshots/page-snapshots.js', () => ({
  snapshotDetails: async (browser: { read: () => Promise<void> }) => {
    await browser.read()
    return { text: '- main: Checkout', returnedChars: 16, truncated: false }
  }
}))

type Tab = BrowserState['tabs'][number]

function fixture(options: { omitUrlDetail?: boolean; onRead?: (tab: Tab) => void } = {}) {
  const tab = {
    id: 'tab', title: 'Checkout', url: 'https://shop.example/checkout?session=query-canary', loading: false, navigationGeneration: 2, documentGeneration: 2,
    handedBack: { at: 7, note: 'The page moved to https://shop.example/checkout?session=query-canary.', noteWithoutUrlDetail: 'The page moved to https://shop.example/checkout.' }
  } as Tab
  const manager = {
    state: () => ({ tabs: [tab] }) as BrowserState,
    read: async () => options.onRead?.(tab),
    captureWorkspaceObservationGuard: () => () => undefined,
    omitAgentUrlDetail: () => options.omitUrlDetail === true
  }
  const workspaceNotices = createWorkspaceNotices()
  return { tab, workspaceNotices, context: { manager: manager as never, requireActiveCapabilityDispatch: vi.fn(), workspaceNotices } }
}

const parsed = (content: Awaited<ReturnType<typeof resolvedRequestPage>>) => JSON.parse((content[0] as { text: string }).text) as {
  page: { url: string; handedBack?: { note: string }; snapshot: { status?: string; reason?: string; returnedChars?: number } }
}

describe('the page that comes with a resolved attention request', () => {
  it('holds the tab, its hand-back note and a snapshot, and the note is not told again', async () => {
    const { context, workspaceNotices } = fixture()
    const content = await resolvedRequestPage(context, 'ws', 'tab', () => undefined)
    expect(parsed(content).page).toMatchObject({ url: 'https://shop.example/checkout?session=query-canary', snapshot: { returnedChars: 16, truncated: false } })
    expect(parsed(content).page.handedBack?.note).toContain('query-canary')
    expect(content[1]).toEqual({ type: 'text', text: '- main: Checkout' })
    expect(context.requireActiveCapabilityDispatch).toHaveBeenCalledWith('browser_snapshot', { workspaceId: 'ws', tabId: 'tab' }, { workspaceId: 'ws', tabId: 'tab' })
    const later = workspaceNotices.withNotices({ content: [{ type: 'text', text: '{}' }] }, { tabs: [fixture().tab] } as unknown as BrowserState,
      { workspaceId: 'ws', resolvedTabId: undefined, omitUrlDetail: false, requireActiveCapabilityDispatch: () => undefined })
    expect(later.content).toHaveLength(1)
  })

  it('keeps URL detail out when the person chose so', async () => {
    const { context } = fixture({ omitUrlDetail: true })
    const content = await resolvedRequestPage(context, 'ws', 'tab', () => undefined)
    expect(JSON.stringify(content[0])).not.toContain('query-canary')
    expect(parsed(content).page.handedBack?.note).toBe('The page moved to https://shop.example/checkout.')
  })

  it('leaves the snapshot out, saying why, when the agent may not read the page or it changed meanwhile', async () => {
    const denied = fixture()
    denied.context.requireActiveCapabilityDispatch.mockImplementation(() => { throw new Error('Agents are paused for this target.') })
    const refused = await resolvedRequestPage(denied.context, 'ws', 'tab', () => undefined)
    expect(refused).toHaveLength(1)
    expect(parsed(refused).page.snapshot).toEqual({ status: 'unavailable', reason: 'Agents are paused for this target.' })

    const moved = fixture({ onRead: tab => { tab.navigationGeneration++ } })
    const changed = await resolvedRequestPage(moved.context, 'ws', 'tab', () => undefined)
    expect(changed).toHaveLength(1)
    expect(parsed(changed).page.snapshot.reason).toContain('changed while it was read')

    const revoked = await resolvedRequestPage(fixture().context, 'ws', 'tab', () => { throw new Error('Workspace access was revoked') })
    expect(parsed(revoked).page.snapshot.reason).toBe('Workspace access was revoked')
  })

  it('returns nothing for a tab that is gone', async () => {
    expect(await resolvedRequestPage(fixture().context, 'ws', 'missing', () => undefined)).toEqual([])
  })
})
