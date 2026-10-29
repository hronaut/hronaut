import { describe, expect, it, vi } from 'vitest'
import type { BrowserState } from '../src/shared/types.js'
import { assertWorkspaceNavigationAllowed, workspaceNavigationAllowed } from '../src/main/browser/workspace-navigation/workspace-navigation.js'
import type {
  WorkspaceNavigationAccess,
  WorkspaceNavigationTab,
  WorkspaceNavigationWorkspace
} from '../src/main/browser/workspace-navigation/workspace-navigation-access.js'

// Regression: a page that refreshed itself as Hronaut quit, after its workspace was forgotten, threw "Unknown
// workspace" out of the tab's will-frame-navigate listener, where nothing caught it.

const WORKSPACE_ID = '01912345-6789-7abc-8def-0123456789ab'

function access(workspace: WorkspaceNavigationWorkspace | undefined) {
  const onWorkspaceNavigationDecision = vi.fn()
  const changed = vi.fn()
  const policyAccess: WorkspaceNavigationAccess<WorkspaceNavigationTab> = {
    findWorkspace: (id) => id === WORKSPACE_ID ? workspace : undefined,
    findArchivedWorkspace: () => undefined,
    assertWorkspaceIdle: () => undefined,
    inspectionPermission: () => undefined,
    setInspectionPermission: () => undefined,
    tabs: () => [][Symbol.iterator](),
    findTab: () => undefined,
    options: () => ({ onWorkspaceNavigationDecision }),
    prepareDiagnosticNavigation: () => undefined,
    wakeTab: async () => undefined,
    forgetWorkspaceClosedTabs: () => undefined,
    changed,
    getState: () => ({}) as BrowserState
  }
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
