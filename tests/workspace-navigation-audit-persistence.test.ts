import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BrowserState, BrowserWorkspaceNavigationAuditEntry } from '../src/shared/types.js'
import { TAB_STATE_VERSION, TabStateStore, type PersistedBrowserState } from '../src/main/browser/tab-store.js'
import { workspaceNavigationAllowed } from '../src/main/browser/workspace-navigation/workspace-navigation.js'
import type {
  WorkspaceNavigationAccess,
  WorkspaceNavigationTab,
  WorkspaceNavigationWorkspace
} from '../src/main/browser/workspace-navigation/workspace-navigation-access.js'

const WORKSPACE_ID = '01912345-6789-7abc-8def-0123456789ab'
const STORAGE_ID = '77777777-1111-4111-8111-111111111111'
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function recordingAccess(workspace: WorkspaceNavigationWorkspace): WorkspaceNavigationAccess<WorkspaceNavigationTab> {
  return {
    findWorkspace: (id) => id === WORKSPACE_ID ? workspace : undefined,
    findArchivedWorkspace: () => undefined,
    assertWorkspaceIdle: () => undefined,
    inspectionPermission: () => undefined,
    setInspectionPermission: () => undefined,
    tabs: () => [][Symbol.iterator](),
    findTab: () => undefined,
    options: () => ({}),
    prepareDiagnosticNavigation: () => undefined,
    wakeTab: async () => undefined,
    forgetWorkspaceClosedTabs: () => undefined,
    changed: () => undefined,
    getState: () => ({}) as BrowserState
  }
}

function stateWithAudit(navigationAudit: BrowserWorkspaceNavigationAuditEntry[]): PersistedBrowserState {
  return {
    version: TAB_STATE_VERSION,
    activeTabId: null,
    mcpTabGroups: [{
      id: WORKSPACE_ID,
      contextClass: 'standard',
      name: 'Research',
      description: '',
      storageId: STORAGE_ID,
      color: 'gray',
      createdAt: '2026-08-20T09:00:00.000Z',
      lastUsedAt: '2026-08-20T09:01:00.000Z',
      activeTabId: null,
      origins: [],
      navigationPolicy: { mode: 'unrestricted', rules: [] },
      navigationAudit
    }],
    savedTabGroups: [],
    tabs: []
  }
}

describe('workspace navigation audit persistence', () => {
  // Regression: an address whose scheme is longer than the saved session's 500-character audit origin limit was
  // recorded verbatim. Every later browser-state save then threw "Workspace navigation audit entry is invalid.", which
  // the tab manager only logs, so tabs and workspaces changed afterwards were silently lost at the next start.
  it('keeps saving the browser state after denying an address with an over-long scheme', async () => {
    const workspace: WorkspaceNavigationWorkspace = {
      contextClass: 'standard',
      lastUsedAt: '2026-08-20T09:01:00.000Z',
      navigationPolicy: { mode: 'unrestricted', rules: [] },
      navigationAudit: []
    }
    const longSchemeAddress = `${'a'.repeat(600)}://example`

    expect(workspaceNavigationAllowed(recordingAccess(workspace), WORKSPACE_ID, longSchemeAddress, 'direct')).toBe(false)
    expect(workspace.navigationAudit).toHaveLength(1)
    expect(workspace.navigationAudit[0]).toMatchObject({ reason: 'unsupported-scheme', source: 'direct' })
    expect(workspace.navigationAudit[0]!.targetOrigin.length).toBeLessThanOrEqual(500)

    const directory = await mkdtemp(join(tmpdir(), 'hronaut-navigation-audit-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'tabs.json')
    const store = new TabStateStore(path)
    await expect(store.save(stateWithAudit(workspace.navigationAudit))).resolves.toBeUndefined()
    expect(JSON.parse(await readFile(path, 'utf8')).mcpTabGroups[0].navigationAudit).toHaveLength(1)
    const restored = await new TabStateStore(path).load()
    expect(restored?.mcpTabGroups?.[0]?.navigationAudit).toEqual(workspace.navigationAudit)
  })

  it('keeps saving the browser state after denying a signed-in address with an over-long host', async () => {
    const workspace: WorkspaceNavigationWorkspace = {
      contextClass: 'standard',
      lastUsedAt: '2026-08-20T09:01:00.000Z',
      navigationPolicy: { mode: 'unrestricted', rules: [] },
      navigationAudit: []
    }

    expect(workspaceNavigationAllowed(recordingAccess(workspace), WORKSPACE_ID, `https://user@${'a'.repeat(600)}.example/`, 'direct')).toBe(false)
    expect(workspace.navigationAudit[0]).toMatchObject({ targetOrigin: 'invalid URL', reason: 'credentials' })

    const directory = await mkdtemp(join(tmpdir(), 'hronaut-navigation-audit-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'tabs.json')
    await expect(new TabStateStore(path).save(stateWithAudit(workspace.navigationAudit))).resolves.toBeUndefined()
  })

  it('still records an ordinary unsupported scheme by its scheme', () => {
    const workspace: WorkspaceNavigationWorkspace = {
      contextClass: 'standard',
      lastUsedAt: '2026-08-20T09:01:00.000Z',
      navigationPolicy: { mode: 'unrestricted', rules: [] },
      navigationAudit: []
    }
    expect(workspaceNavigationAllowed(recordingAccess(workspace), WORKSPACE_ID, 'file:///etc/hosts', 'direct')).toBe(false)
    expect(workspace.navigationAudit[0]).toMatchObject({ targetOrigin: 'file:', reason: 'unsupported-scheme' })
  })
})
