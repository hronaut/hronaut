import { expect, test } from './fixtures.js'
import type { HronautApi } from '../../src/shared/types.js'
import { MAX_ARCHIVED_WORKSPACES } from '../../src/shared/undo.js'

test('two workspaces archived together cannot both take the last archive place', async ({ appWindow }) => {
  const outcome = await appWindow.evaluate(async (max) => {
    const hronaut = (window as unknown as { hronaut: HronautApi }).hronaut
    const create = async (name: string): Promise<string> => {
      const state = await hronaut.createWorkspace({ name, storage: 'scratch' })
      return state.mcpTabGroups.find(group => group.name === name)!.id
    }
    for (let index = 0; index < max - 1; index += 1) await hronaut.saveAndCloseTabGroup(await create(`Archived ${index}`))
    const first = await create('First')
    const second = await create('Second')
    await hronaut.newTab({ url: 'about:blank', mcpGroupId: second, active: false })
    const state = await hronaut.newTab({ url: 'about:blank', mcpGroupId: first, active: false })
    const labeled = state.tabs.find(tab => tab.mcpGroupId === first)!.id
    // Both archives wait for a tab label being saved, as they do when a person renames a tab just before, so they go on
    // together once it is saved.
    const label = hronaut.setTabLabel(labeled, 'Draft')
    const results = await Promise.allSettled([hronaut.saveAndCloseTabGroup(first), hronaut.saveAndCloseTabGroup(second)])
    await label
    const after = await hronaut.getState()
    return {
      statuses: results.map(result => result.status).sort(),
      refusal: results.flatMap(result => result.status === 'rejected' ? [String(result.reason)] : []),
      archived: after.savedTabGroups.length,
      stillOpen: after.mcpTabGroups.filter(group => group.name === 'First' || group.name === 'Second').length
    }
  }, MAX_ARCHIVED_WORKSPACES)

  // A saved state with more archives than the limit stops the next start with a recovery notice.
  expect(outcome).toEqual({
    statuses: ['fulfilled', 'rejected'],
    refusal: [expect.stringContaining(`Hronaut can keep up to ${MAX_ARCHIVED_WORKSPACES} archived workspaces.`)],
    archived: MAX_ARCHIVED_WORKSPACES,
    stillOpen: 1
  })
})
