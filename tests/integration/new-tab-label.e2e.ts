import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { test, expect, text, installLabelFault, labelFault, releaseLabelFault, restoreLabelFault } from './new-tab-label-fixtures.js'

test('creates normalized independent MCP labels with exact identities and no compact-discovery expansion', async ({ capabilities, appWindow, profileDirectory }) => {
  const { client, workspace, fixtureUrl } = capabilities
  const create = (label?: string) => client.callTool({ name: 'browser_new_tab', arguments: { url: fixtureUrl, active: false, ...(label === undefined ? {} : { label }) } }) as Promise<CallToolResult>
  const results = [await create('  Cre\u0301ation role  '), await create('  Cre\u0301ation role  ')]
  const ids: string[] = []
  for (const result of results) {
    expect(result.isError, text(result)).not.toBe(true)
    const body = JSON.parse(text(result)); ids.push(body.createdTabId)
    expect(body).toMatchObject({ status: 'CREATED', labelPersistence: 'saved', retrySafe: false })
    expect(body.tabs.find((tab: { id: string }) => tab.id === body.createdTabId)).toMatchObject({ label: 'Création role', workspaceId: workspace.workspaceId })
  }
  expect(new Set(ids).size).toBe(2)
  const persisted = JSON.parse(await readFile(join(profileDirectory, 'tabs.json'), 'utf8'))
  for (const id of ids) expect(persisted.tabs.find((tab: { id: string }) => tab.id === id).label).toBe('Création role')
  const compact = await client.callTool({ name: 'browser_tabs', arguments: { search: { query: 'Création role' } } }) as CallToolResult
  expect(compact.isError, text(compact)).not.toBe(true)
  expect(text(compact)).not.toContain('Création role')
  for (const id of ids) expect(text(compact)).not.toContain(id)
  const plain = JSON.parse(text(await create()))
  expect(plain).not.toHaveProperty('createdTabId'); expect(plain).not.toHaveProperty('labelPersistence')
  const state = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  expect(state.tabs.filter(tab => ids.includes(tab.id)).every(tab => tab.title !== tab.label)).toBe(true)
})

test('invalid MCP label inputs create no tabs and leave the workspace usable', async ({ capabilities, appWindow }) => {
  const { client, fixtureUrl } = capabilities
  const before = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  for (const label of ['bad\nvalue', '\ud800', 'a'.repeat(101), 'a'.repeat(1025), 42, null]) {
    const result = await client.callTool({ name: 'browser_new_tab', arguments: { url: fixtureUrl, label } }) as CallToolResult
    expect(result.isError).toBe(true)
  }
  const after = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  expect(after.tabs.map(tab => tab.id)).toEqual(before.tabs.map(tab => tab.id))
})

for (const mode of ['reject', 'directory'] as const) {
  test(`reports ${mode} persistence failure without repeating or rolling back tab creation`, async ({ capabilities, electronApp, appWindow, profileDirectory }) => {
    const { client, fixtureUrl } = capabilities
    const marker = `Creation failure ${mode}`
    await installLabelFault(electronApp, profileDirectory, marker, mode)
    try {
      const result = await client.callTool({ name: 'browser_new_tab', arguments: { url: fixtureUrl, label: marker } }) as CallToolResult
      expect(result.isError === true).toBe(mode === 'reject')
      const body = JSON.parse(text(result))
      expect(body.labelPersistence).toBe(mode === 'reject' ? 'not-saved' : 'durability-unconfirmed')
      expect(body.retrySafe).toBe(false)
      const state = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
      const tab = state.tabs.find(tab => tab.id === body.createdTabId)!
      expect(tab).toBeTruthy(); expect(tab.label).toBe(mode === 'reject' ? undefined : marker)
      if (mode === 'directory') expect(tab.labelDurabilityUnconfirmed).toBe(true)
    } finally { await restoreLabelFault(electronApp) }
  })
}

test('an admitted creation label cannot overwrite a newer human label or lose its tab identity', async ({ capabilities, electronApp, appWindow, profileDirectory }) => {
  const { client, fixtureUrl } = capabilities
  const marker = 'Creation queued role'
  await installLabelFault(electronApp, profileDirectory, marker, 'hold-rename')
  let creation: Promise<CallToolResult> | undefined, edit: Promise<unknown> | undefined
  try {
    const prior = new Set((await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())).tabs.map(tab => tab.id))
    creation = client.callTool({ name: 'browser_new_tab', arguments: { url: fixtureUrl, label: marker } }) as Promise<CallToolResult>
    await expect.poll(async () => (await labelFault(electronApp)).entered).toBe(true)
    const state = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    const id = state.tabs.find(tab => !prior.has(tab.id))!.id
    expect(state.tabs.find(tab => tab.id === id)?.label).toBeUndefined()
    edit = appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabLabel(id, 'Newer human role'), id)
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: false }), fixtureUrl)
    await releaseLabelFault(electronApp)
    const result = await creation; await edit
    expect(JSON.parse(text(result)).createdTabId).toBe(id)
    const current = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    expect(current.tabs.find(tab => tab.id === id)?.label).toBe('Newer human role')
    const disk = JSON.parse(await readFile(join(profileDirectory, 'tabs.json'), 'utf8')) as BrowserState
    expect(disk.tabs.find(tab => tab.id === id)?.label).toBe('Newer human role')
  } finally { await restoreLabelFault(electronApp); await Promise.allSettled([creation, edit].filter(Boolean)) }
})
