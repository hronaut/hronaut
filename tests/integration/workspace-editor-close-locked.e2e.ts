import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('closes a workspace from Edit workspace while all tabs are locked, as Home Clear does', async ({ appWindow, electronApp }) => {
  const workspaceId = await appWindow.evaluate(async () => {
    const api = (window as unknown as { hronaut: HronautApi }).hronaut
    const state: BrowserState = await api.createWorkspace({ name: 'Locked clear', storage: 'scratch' })
    const id = state.mcpTabGroups.find(group => group.name === 'Locked clear')!.id
    await api.newTab({ mcpGroupId: id, url: 'data:text/html,<title>Locked clear page</title>', active: true })
    await api.setAllHumanInteractionLocked(true)
    return id
  })
  await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(state => state.allHumanInteractionLocked))).toBe(true)
  await electronApp.evaluate(({ BrowserWindow }, id) => { BrowserWindow.getAllWindows()[0]!.webContents.send('browser:edit-tab-group', id) }, workspaceId)
  const dialog = appWindow.getByRole('dialog', { name: 'Edit workspace' })
  const close = dialog.getByRole('button', { name: 'Close workspace', exact: true })
  // 2.41.0 disabled this button under the global lock, with only a tooltip as explanation.
  await expect(close).toBeEnabled()
  appWindow.once('dialog', confirm => confirm.accept())
  await close.click()
  await expect.poll(() => appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    .then(state => state.mcpTabGroups.some(group => group.id === id)), workspaceId)).toBe(false)
  await expect(dialog).toBeHidden()
  // The global lock itself stays on.
  expect(await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(state => state.allHumanInteractionLocked))).toBe(true)
})
