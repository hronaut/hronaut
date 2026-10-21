import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

// A tab you muted came back with sound after Reopen Closed Tab and after its workspace was archived and restored,
// although a restart kept it muted.

const page = 'data:text/html,<title>Autoplay</title><main>Autoplay</main>'

test('keeps a tab muted when it is reopened or its workspace is restored', async ({ appWindow, electronApp }) => {
  const workspace = await appWindow.evaluate(async (url) => {
    const api = (window as unknown as { hronaut: HronautApi }).hronaut
    const state = await api.createWorkspace({ name: 'Muted work', storage: 'scratch' })
    const id = state.mcpTabGroups.find(group => group.name === 'Muted work')!.id
    const tabId = (await api.newTab({ url, mcpGroupId: id, active: true })).activeTabId!
    await api.setTabMuted(tabId, true)
    return { id, tabId }
  }, page)
  const mutedTab = () => appWindow.evaluate(async (id) => {
    const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    const tab = state.tabs.find(candidate => candidate.mcpGroupId === id && candidate.title === 'Autoplay')
    return tab ? { tabMuted: tab.tabMuted, muted: tab.muted } : undefined
  }, workspace.id)
  const pageMuted = () => electronApp.evaluate(({ webContents }) => (
    webContents.getAllWebContents().find(contents => contents.getTitle() === 'Autoplay')?.isAudioMuted()
  ))
  await expect.poll(mutedTab).toEqual({ tabMuted: true, muted: true })
  await expect.poll(pageMuted).toBe(true)

  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), workspace.tabId)
  await expect.poll(mutedTab).toBeUndefined()
  await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.reopenClosedTab())
  await expect.poll(mutedTab).toEqual({ tabMuted: true, muted: true })
  await expect.poll(pageMuted).toBe(true)

  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.saveAndCloseTabGroup(id), workspace.id)
  await expect.poll(mutedTab).toBeUndefined()
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.restoreSavedTabGroup(id), workspace.id)
  await expect.poll(mutedTab).toEqual({ tabMuted: true, muted: true })
  await expect.poll(pageMuted).toBe(true)
})
