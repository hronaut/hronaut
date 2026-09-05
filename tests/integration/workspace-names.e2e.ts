import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('suggests a playful editable workspace name and creates the chosen name', async ({ appWindow }, testInfo) => {
  await appWindow.getByRole('button', { name: 'Create workspace', exact: true }).click()
  const editor = appWindow.getByRole('dialog', { name: 'Create workspace', exact: true })
  const name = editor.getByLabel('Workspace name', { exact: true })
  const suggested = await name.inputValue()
  expect(suggested).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+(?: \d+)?$/)
  expect(suggested).not.toBe('New workspace')
  await editor.getByRole('radio', { name: 'Green', exact: true }).click()
  await expect(name).toHaveValue(suggested)
  await editor.screenshot({ path: testInfo.outputPath('suggested-workspace.png') })
  await editor.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await expect(editor).toBeHidden()
  await expect.poll(() => appWindow.evaluate(async () => {
    const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    return state.mcpTabGroups.find(group => group.id === state.tabs.find(tab => tab.active)?.mcpGroupId)?.name
  })).toBe(suggested)

  await appWindow.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await expect(name).not.toHaveValue(suggested)
  await name.fill('Launch checks')
  await editor.getByRole('radio', { name: 'Cyan', exact: true }).click()
  await expect(name).toHaveValue('Launch checks')
  await editor.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await expect(editor).toBeHidden()
  const names = await appWindow.evaluate(async () => {
    const bridge = (window as unknown as { hronaut: HronautApi }).hronaut
    const state = await bridge.createWorkspace({ name: 'Explicit API name', color: 'purple', storage: 'scratch' })
    return state.mcpTabGroups.map(group => group.name)
  })
  expect(names).toEqual(expect.arrayContaining([suggested, 'Launch checks', 'Explicit API name']))
})
