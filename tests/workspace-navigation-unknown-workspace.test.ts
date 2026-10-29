import { describe, expect, it, vi } from 'vitest'
import type { BrowserState } from '../src/shared/types.js'
import { assertWorkspaceNavigationAllowed, workspaceNavigationAllowed } from '../src/main/browser/workspace-navigation/workspace-navigation.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { ActiveWorkspace } from '../src/main/browser/workspace-registry.js'

// The browsers below stub changed and getState, which the navigation policy publishes through.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))

/** The workspace fields the navigation policy reads and writes: the policy itself and its audit of denials. */
type WorkspaceNavigationWorkspace = Pick<ActiveWorkspace, 'contextClass' | 'lastUsedAt' | 'navigationPolicy' | 'navigationAudit'>

// Regression: a page that refreshed itself as Hronaut quit, after its workspace was forgotten, threw "Unknown
// workspace" out of the tab's will-frame-navigate listener, where nothing caught it.

const WORKSPACE_ID = '01912345-6789-7abc-8def-0123456789ab'

function access(workspace: WorkspaceNavigationWorkspace | undefined) {
  const onWorkspaceNavigationDecision = vi.fn()
  const changed = vi.fn()
  const policyAccess = {
    mcpTabGroups: new Map(workspace ? [[WORKSPACE_ID, workspace]] : []),
    savedTabGroups: new Map(),
    inspectionPermissions: new WeakMap(),
    tabs: new Map(),
    options: { onWorkspaceNavigationDecision },
    changed,
    getState: () => ({}) as BrowserState
  } as unknown as Browser
  return { policyAccess, onWorkspaceNavigationDecision, changed }
}

describe('a navigation in a workspace that is gone', () => {
  it('is refused without an error, reporting and recording nothing', () => {
    const { policyAccess, onWorkspaceNavigationDecision, changed } = access(undefined)
    for (const source of ['page', 'redirect', 'popup', 'history'] as const) {
      expect(workspaceNavigationAllowed(policyAccess, WORKSPACE_ID, 'https://example.com/', source), source).toBe(false)
    }
    expect(onWorkspaceNavigationDecision).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
  })

  it('still fails a navigation Hronaut was asked for, naming the workspace', () => {
    const { policyAccess } = access(undefined)
    expect(() => assertWorkspaceNavigationAllowed(policyAccess, WORKSPACE_ID, 'https://example.com/', 'direct')).toThrow(`Unknown workspace: ${WORKSPACE_ID}.`)
  })

  it('is decided by the policy while the workspace exists', () => {
    const workspace: WorkspaceNavigationWorkspace = {
      contextClass: 'standard',
      lastUsedAt: '2026-10-29T15:00:00.000Z',
      navigationPolicy: { mode: 'unrestricted', rules: [] },
      navigationAudit: []
    }
    const { policyAccess, onWorkspaceNavigationDecision } = access(workspace)
    expect(workspaceNavigationAllowed(policyAccess, WORKSPACE_ID, 'https://example.com/', 'page')).toBe(true)
    expect(onWorkspaceNavigationDecision).toHaveBeenCalledOnce()
  })
})
