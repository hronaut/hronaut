import { expect, test } from './fixtures.js'
import type { HronautApi } from '../../src/shared/types.js'

test('forks an archived workspace with direct access disabled into an independent blank workspace', async ({ appWindow }) => {
  const sourceId = await appWindow.evaluate(async () => {
    const state = await (window as unknown as { hronaut: HronautApi }).hronaut.createWorkspace({
      name: 'Human source', storage: 'scratch', agentAccess: false,
      navigationPolicy: { mode: 'restricted', rules: ['https://example.com'] }
    })
    return state.mcpTabGroups.find((group) => group.name === 'Human source')!.id
  })
  await appWindow.evaluate(async (id) => { await (window as unknown as { hronaut: HronautApi }).hronaut.saveAndCloseTabGroup(id) }, sourceId)
  const state = await appWindow.evaluate(async (id) => (window as unknown as { hronaut: HronautApi }).hronaut.createWorkspace({
    name: 'Independent fork', storage: 'fork-workspace', sourceWorkspaceId: id
  }), sourceId)
  const fork = state.mcpTabGroups.find((group) => group.name === 'Independent fork')!
  expect(fork.id).not.toBe(sourceId)
  expect(fork.agentAccess).toBe(true)
  expect(fork.navigationPolicy).toEqual({ mode: 'restricted', rules: ['https://example.com'] })
  expect(state.tabs.filter((tab) => tab.mcpGroupId === fork.id)).toMatchObject([{ url: 'about:blank' }])
  expect(state.savedTabGroups.find((group) => group.id === sourceId)).toMatchObject({ agentAccess: false })
  await appWindow.evaluate(async (id) => { await (window as unknown as { hronaut: HronautApi }).hronaut.updateTabGroup(id, { agentAccess: false }) }, fork.id)
  expect(await appWindow.evaluate(async (id) => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).mcpTabGroups.find((group) => group.id === id)?.agentAccess, fork.id)).toBe(false)
})

test('rejects invalid direct access values and same-workspace transfers without changing the workspace', async ({ appWindow }) => {
  const result = await appWindow.evaluate(async () => {
    const state = await (window as unknown as { hronaut: HronautApi }).hronaut.createWorkspace({ name: 'Transfer guard', storage: 'scratch' })
    const workspace = state.mcpTabGroups.find((group) => group.name === 'Transfer guard')!
    const update = await (window as unknown as { hronaut: HronautApi }).hronaut.updateTabGroup(workspace.id, { name: 'Must not be renamed', agentAccess: 'false' } as never).then(() => 'accepted', () => 'rejected')
    const transfer = await (window as unknown as { hronaut: HronautApi }).hronaut.transferWorkspaceStorage({ sourceWorkspaceId: workspace.id, targetWorkspaceId: workspace.id, mode: 'move' }).then(() => 'accepted', () => 'rejected')
    return { update, transfer, workspace: (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).mcpTabGroups.find((group) => group.id === workspace.id) }
  })
  expect(result).toMatchObject({ update: 'rejected', transfer: 'rejected', workspace: { name: 'Transfer guard', agentAccess: true, tabCount: 1 } })
})

test('starts without Default and does not recreate a deleted last workspace', async ({ appWindow }) => {
  const initial = await appWindow.evaluate(async () => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  expect(initial.mcpTabGroups).toEqual([])
  expect(initial.tabs.map(tab => tab.url)).toEqual(['hronaut://home/'])
  const created = await appWindow.evaluate(async () => (window as unknown as { hronaut: HronautApi }).hronaut.newTab())
  expect(created.mcpTabGroups).toHaveLength(1)
  expect(created.mcpTabGroups[0]!.name).not.toBe('Default')
  const deleted = await appWindow.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.closeWorkspace(id), created.mcpTabGroups[0]!.id)
  expect(deleted.mcpTabGroups).toEqual([])
  expect(deleted.tabs.map(tab => tab.url)).toEqual(['hronaut://home/'])
})
