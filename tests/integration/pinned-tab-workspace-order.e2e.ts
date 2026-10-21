import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

// A pinned tab in any workspace but the first came before every other workspace's tabs, so Ctrl+1 showed it rather
// than the first tab on screen, and closing it showed the first workspace's tab rather than the next one beside it.

const page = (title: string) => `data:text/html,<title>${title}</title><main>${title}</main>`

test('keeps a later workspace\'s pinned tab in its place for tab shortcuts and closing', async ({ appWindow }) => {
  const primary = process.platform === 'darwin' ? 'Meta' : 'Control'
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
    const work = await workspace('Order work')
    const docs = await workspace('Order docs')
    const open = async (url: string, mcpGroupId: string) => (await api.newTab({ url, mcpGroupId, active: true })).activeTabId!
    await open(pages.workOne, work)
    await open(pages.workTwo, work)
    const docsPinned = await open(pages.docsPinned, docs)
    await open(pages.docsTwo, docs)
    await api.setTabPinned(docsPinned, true)
    for (const id of starting) await api.closeTab(id)
    return { docsPinned }
  }, { workOne: page('Work one'), workTwo: page('Work two'), docsPinned: page('Docs pinned'), docsTwo: page('Docs two') })
  const titles = () => appWindow.evaluate(async () => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    .tabs.filter(tab => !tab.url.startsWith('hronaut://')).map(tab => tab.title))
  const activeTitle = () => appWindow.evaluate(async () => {
    const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    return state.tabs.find(tab => tab.id === state.activeTabId)?.title
  })
  await expect.poll(titles).toEqual(['Work one', 'Work two', 'Docs pinned', 'Docs two'])

  await appWindow.getByRole('combobox', { name: 'Address' }).focus()
  await appWindow.keyboard.press(`${primary}+1`)
  await expect.poll(activeTitle).toBe('Work one')

  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), ids.docsPinned)
  await expect.poll(activeTitle).toBe('Docs pinned')
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), ids.docsPinned)
  await expect.poll(activeTitle).toBe('Docs two')
})
