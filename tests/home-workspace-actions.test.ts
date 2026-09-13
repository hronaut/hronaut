import { describe, expect, it, vi } from 'vitest'
import { runHomeWorkspaceAction } from '../src/main/home-workspace-actions.js'
import type { BrowserState } from '../src/shared/types.js'

function harness() {
  const state = {
    activeTabId: 'home', allHumanInteractionLocked: false,
    mcpTabGroups: [{ id: 'active', name: 'Project', activeTabId: null }],
    savedTabGroups: [{ id: 'archived', name: 'Archive' }],
    tabs: []
  } as unknown as BrowserState
  const manager = {
    getState: () => state, openHome: vi.fn(), selectTab: vi.fn(), newTab: vi.fn(),
    saveAndCloseTabGroup: vi.fn(), closeWorkspace: vi.fn(), restoreSavedTabGroup: vi.fn(), deleteSavedTabGroup: vi.fn(),
    updateMcpTabGroup: vi.fn(), updateArchivedWorkspacePreferences: vi.fn()
  }
  const edit = vi.fn()
  return { state, manager, edit, run: (input: unknown) => runHomeWorkspaceAction(manager, input, edit) }
}

describe('trusted Home workspace actions', () => {
  it('opens an empty workspace in its own scope and returns only Home fields', async () => {
    const h = harness()
    const result = await h.run({ view: 'open', workspaceId: 'active' })
    expect(h.manager.newTab).toHaveBeenCalledWith({ mcpGroupId: 'active', active: true })
    expect(Object.keys(result).sort()).toEqual(['activeTabId', 'allHumanInteractionLocked', 'mcpTabGroups', 'savedTabGroups', 'tabs'])
  })
  it('keeps Undo archive on Home and opens an archive directly when requested', async () => {
    const h = harness()
    await h.run({ view: 'restore', workspaceId: 'archived' })
    expect(h.manager.restoreSavedTabGroup).toHaveBeenCalledWith('archived')
    expect(h.manager.openHome).toHaveBeenCalledOnce()
    await h.run({ view: 'open', workspaceId: 'archived' })
    expect(h.manager.openHome).toHaveBeenCalledOnce()
  })
  it('rejects invalid operations and stale workspaces before acting', async () => {
    const h = harness()
    for (const input of [null, [], { view: 'delete', workspaceId: 'missing' }, { view: 'bogus', workspaceId: 'active' }, { view: 'preferences', workspaceId: 'active', deletionProtected: 'false' }]) {
      await expect(h.run(input)).rejects.toThrow()
    }
    expect(h.manager.deleteSavedTabGroup).not.toHaveBeenCalled()
    expect(h.manager.updateMcpTabGroup).not.toHaveBeenCalled()
  })
  it('passes only human preferences to the selected active or archived workspace', async () => {
    const h = harness()
    await h.run({ view: 'preferences', workspaceId: 'active', deletionProtected: true, agentAccess: false, name: 'injected' })
    expect(h.manager.updateMcpTabGroup).toHaveBeenCalledWith('active', { deletionProtected: true })
    await h.run({ view: 'preferences', workspaceId: 'archived', hiddenFromSidebar: false })
    expect(h.manager.updateArchivedWorkspacePreferences).toHaveBeenCalledWith('archived', { hiddenFromSidebar: false })
  })
  it('respects global interaction lock for destructive lifecycle operations', async () => {
    const h = harness()
    h.state.allHumanInteractionLocked = true
    await expect(h.run({ view: 'archive', workspaceId: 'active' })).rejects.toThrow('Unlock')
    await expect(h.run({ view: 'delete', workspaceId: 'archived' })).rejects.toThrow('Unlock')
    expect(h.manager.saveAndCloseTabGroup).not.toHaveBeenCalled()
    expect(h.manager.deleteSavedTabGroup).not.toHaveBeenCalled()
  })

  it('clears an active workspace from trusted Home even while website input is locked', async () => {
    const h = harness()
    h.state.allHumanInteractionLocked = true

    await h.run({ view: 'clear', workspaceId: 'active' })

    expect(h.manager.closeWorkspace).toHaveBeenCalledWith('active')
    expect(h.manager.saveAndCloseTabGroup).not.toHaveBeenCalled()
  })
})
