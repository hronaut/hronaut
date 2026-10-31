import { describe, expect, it, vi } from 'vitest'
import type { BrowserState } from '../src/shared/types.js'
import { workspaceMayOpen } from '../src/main/browser/workspace-navigation/workspace-navigation.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { ActiveWorkspace } from '../src/main/browser/workspace-registry/workspace-registry.js'

// The browser below stubs changed and getState, which the navigation policy publishes through.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))

type WorkspaceNavigationWorkspace = Pick<ActiveWorkspace, 'contextClass' | 'lastUsedAt' | 'navigationPolicy' | 'navigationAudit'>

const WORKSPACE_ID = '01912345-6789-7abc-8def-0123456789ab'

// Back and Forward look at the pages further along in a tab's history, which they do not go to: looking reports
// nothing and adds nothing to the workspace's audit of denials.
describe('looking at whether a workspace may open a page', () => {
  it('answers by the policy, reporting and recording nothing', () => {
    const workspace: WorkspaceNavigationWorkspace = {
      contextClass: 'standard',
      lastUsedAt: '2026-10-31T11:00:00.000Z',
      navigationPolicy: { mode: 'restricted', rules: ['https://allowed.example'] },
      navigationAudit: []
    }
    const onWorkspaceNavigationDecision = vi.fn()
    const changed = vi.fn()
    const browser = {
      mcpTabGroups: new Map([[WORKSPACE_ID, workspace]]),
      savedTabGroups: new Map(),
      inspectionPermissions: new WeakMap(),
      tabs: new Map(),
      options: { onWorkspaceNavigationDecision },
      changed,
      getState: () => ({}) as BrowserState
    } as unknown as Browser
    expect(workspaceMayOpen(browser, WORKSPACE_ID, 'https://allowed.example/next')).toBe(true)
    expect(workspaceMayOpen(browser, WORKSPACE_ID, 'https://dropped.example/')).toBe(false)
    expect(workspaceMayOpen(browser, WORKSPACE_ID, 'file:///etc/hosts')).toBe(false)
    // A workspace that is gone may open nothing.
    expect(workspaceMayOpen(browser, '01912345-6789-7abc-8def-0123456789ac', 'https://allowed.example/')).toBe(false)
    expect(onWorkspaceNavigationDecision).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
    expect(workspace.navigationAudit).toEqual([])
  })
})
