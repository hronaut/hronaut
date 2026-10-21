import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

// Every restart marked each open workspace as used at startup: putting its saved tabs back counted as a use, so Home's
// workspace cards all read "Last used now", and the workspace switcher and Alt+0 lost which one was used last.

const lastUsed = (page: Page) => page.evaluate(async () => Object.fromEntries(
  (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).mcpTabGroups.map(group => [group.name, group.lastUsedAt])
))

test('keeps when each workspace was last used across a restart', async ({ profileDirectory, mcpPort }) => {
  let first: Awaited<ReturnType<typeof launchHronaut>> | undefined
  let second: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    first = await launchHronaut(profileDirectory, mcpPort)
    const open = (name: string) => first!.window.evaluate(async (name) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const state = await api.createWorkspace({ name, storage: 'scratch' })
      const id = state.mcpTabGroups.find(group => group.name === name)!.id
      await api.newTab({ url: `data:text/html,<title>${name}</title>`, mcpGroupId: id, active: true })
    }, name)
    await open('Used earlier')
    // Times are kept to the millisecond, so a pause tells the two uses apart.
    await new Promise(resolve => setTimeout(resolve, 50))
    await open('Used last')
    const before = await lastUsed(first.window)
    expect(before['Used earlier']! < before['Used last']!).toBe(true)
    await expect.poll(async () => {
      const saved = JSON.parse(await readFile(join(profileDirectory, 'tabs.json'), 'utf8').catch(() => '{}')) as { mcpTabGroups?: Array<{ name: string; lastUsedAt: string }> }
      return saved.mcpTabGroups?.find(group => group.name === 'Used last')?.lastUsedAt
    }).toBe(before['Used last'])
    await closeHronaut(first.app)
    first = undefined

    second = await launchHronaut(profileDirectory, mcpPort)
    await expect.poll(async () => (await lastUsed(second!.window))['Used earlier']).toBe(before['Used earlier'])
    // The workspace whose tab is in view is in use again.
    expect((await lastUsed(second.window))['Used last']! >= before['Used last']!).toBe(true)
  } finally {
    if (first) await closeHronaut(first.app)
    if (second) await closeHronaut(second.app)
  }
})
