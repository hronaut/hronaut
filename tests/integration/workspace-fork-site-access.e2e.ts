import type { BrowserWorkspaceNavigationPolicy, HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('a copy of a workspace keeps the Site access the person chose, never looser than the source', async ({ appWindow }) => {
  const outcome = await appWindow.evaluate(async () => {
    const hronaut = (window as unknown as { hronaut: HronautApi }).hronaut
    const create = async (name: string, options: { source?: string; navigationPolicy?: BrowserWorkspaceNavigationPolicy }) => {
      try {
        const state = await hronaut.createWorkspace({
          name,
          ...(options.source ? { storage: 'fork-workspace' as const, sourceWorkspaceId: options.source } : { storage: 'scratch' as const }),
          ...(options.navigationPolicy ? { navigationPolicy: options.navigationPolicy } : {})
        })
        const workspace = state.mcpTabGroups.find(group => group.name === name)!
        return { id: workspace.id, policy: workspace.navigationPolicy }
      } catch (error) {
        return { refused: String(error), stillAbsent: !(await hronaut.getState()).mcpTabGroups.some(group => group.name === name) }
      }
    }
    const sourceId = (created: Awaited<ReturnType<typeof create>>) => {
      if (!('id' in created)) throw new Error(`Could not create a source workspace: ${created.refused}`)
      return created.id
    }
    const app = { mode: 'restricted' as const, rules: ['https://app.example'] }
    const open = sourceId(await create('Open source', {}))
    const listed = sourceId(await create('Listed source', { navigationPolicy: { mode: 'restricted', rules: ['https://app.example', 'https://docs.example'] } }))
    return {
      fromOpen: await create('Copy of open', { source: open, navigationPolicy: app }),
      narrower: await create('Narrower copy', { source: listed, navigationPolicy: app }),
      anySite: await create('Any site copy', { source: listed, navigationPolicy: { mode: 'unrestricted', rules: [] } }),
      wider: await create('Wider copy', { source: listed, navigationPolicy: { mode: 'restricted', rules: ['https://other.example'] } })
    }
  })

  // The person's own rules used to be replaced by the source's, so a copy of an open workspace allowed every site.
  expect(outcome.fromOpen).toMatchObject({ policy: { mode: 'restricted', rules: ['https://app.example'] } })
  expect(outcome.narrower).toMatchObject({ policy: { mode: 'restricted', rules: ['https://app.example'] } })
  expect(outcome.anySite).toMatchObject({ policy: { mode: 'restricted', rules: ['https://app.example', 'https://docs.example'] } })
  expect(outcome.wider).toEqual({
    refused: expect.stringContaining('A copy of "Listed source" can use only Site access rules that "Listed source" lists.'),
    stillAbsent: true
  })
})
