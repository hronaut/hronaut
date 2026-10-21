import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

// A tab whose agents you paused and whose input you locked came back open to agents and to you after Reopen Closed
// Tab and after its workspace was archived and restored, although a restart kept both.

const page = 'data:text/html,<title>Account</title><main>Account</main>'

test('keeps a tab paused and locked when it is reopened or its workspace is restored', async ({ appWindow }) => {
  const workspace = await appWindow.evaluate(async (url) => {
    const api = (window as unknown as { hronaut: HronautApi }).hronaut
    const state = await api.createWorkspace({ name: 'Guarded work', storage: 'scratch' })
    const id = state.mcpTabGroups.find(group => group.name === 'Guarded work')!.id
    const tabId = (await api.newTab({ url, mcpGroupId: id, active: true })).activeTabId!
    await api.setTabAgentPaused(tabId, true)
    await api.setTabHumanInteractionLocked(tabId, true)
    return { id, tabId }
  }, page)
  const guards = () => appWindow.evaluate(async (id) => {
    const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    const tab = state.tabs.find(candidate => candidate.mcpGroupId === id && candidate.title === 'Account')
    return tab ? { agentPaused: tab.agentPaused, inputLocked: tab.humanInteractionInputLocked } : undefined
  }, workspace.id)
  const GUARDED = { agentPaused: true, inputLocked: true }
  await expect.poll(guards).toEqual(GUARDED)

  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), workspace.tabId)
  await expect.poll(guards).toBeUndefined()
  await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.reopenClosedTab())
  await expect.poll(guards).toEqual(GUARDED)

  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.saveAndCloseTabGroup(id), workspace.id)
  await expect.poll(guards).toBeUndefined()
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.restoreSavedTabGroup(id), workspace.id)
  await expect.poll(guards).toEqual(GUARDED)
})
