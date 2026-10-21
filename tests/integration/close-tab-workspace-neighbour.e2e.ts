import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

// Closing the last tab of a workspace's row showed the first tab of the next workspace, though the tab to its left in
// the same workspace was still open.

const page = (title: string) => `data:text/html,<title>${title}</title><main>${title}</main>`

test('shows the tab beside the closed one in its own workspace', async ({ appWindow }) => {
  const ids = await appWindow.evaluate(async (pages) => {
    const api = (window as unknown as { hronaut: HronautApi }).hronaut
    const starting: string[] = []
    // A new workspace opens with a New tab, closed once the workspace has the tabs below.
    const workspace = async (name: string) => {
      const state = await api.createWorkspace({ name, storage: 'scratch' })
      const id = state.mcpTabGroups.find(group => group.name === name)!.id
      starting.push(...state.tabs.filter(tab => tab.mcpGroupId === id).map(tab => tab.id))
      return id
    }
    const work = await workspace('Hand-over work')
    const docs = await workspace('Hand-over docs')
    const open = async (url: string, mcpGroupId: string) => (await api.newTab({ url, mcpGroupId, active: true })).activeTabId!
    await open(pages.workOne, work)
    const workTwo = await open(pages.workTwo, work)
    await open(pages.docsOne, docs)
    for (const id of starting) await api.closeTab(id)
    return { workTwo }
  }, { workOne: page('Work one'), workTwo: page('Work two'), docsOne: page('Docs one') })
  const titles = () => appWindow.evaluate(async () => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    .tabs.filter(tab => !tab.url.startsWith('hronaut://')).map(tab => tab.title))
  const activeTitle = () => appWindow.evaluate(async () => {
    const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    return state.tabs.find(tab => tab.id === state.activeTabId)?.title
  })
  await expect.poll(titles).toEqual(['Work one', 'Work two', 'Docs one'])

  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), ids.workTwo)
  await expect.poll(activeTitle).toBe('Work two')
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), ids.workTwo)
  await expect.poll(titles).toEqual(['Work one', 'Docs one'])
  await expect.poll(activeTitle).toBe('Work one')
})
