import { readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'
import { seedWorkspaceProfile } from './workspace-profile.js'

test('discards obsolete Chromium profiles and tab state before opening sessions', async ({ profileDirectory }) => {
  await seedWorkspaceProfile(profileDirectory)
  let instance = await launchHronaut(profileDirectory)
  const isolatedPartition = 'hronaut-workspace-77777777-1111-4111-8111-111111111111'
  try {
    await instance.app.evaluate(async ({ session }, isolatedPartition) => {
      for (const name of ['hronaut', isolatedPartition]) {
        const profile = session.fromPartition(`persist:${name}`)
        await profile.cookies.set({ url: 'https://obsolete.example', name: 'obsolete-cookie', value: 'discard', expirationDate: Math.floor(Date.now() / 1000) + 3600 })
        await profile.cookies.flushStore()
      }
    }, isolatedPartition)
    await closeHronaut(instance.app)
    const tabsPath = join(profileDirectory, 'tabs.json')
    const state = JSON.parse(await readFile(tabsPath, 'utf8'))
    state.version = 2
    await writeFile(tabsPath, JSON.stringify(state))
    const settingsPath = join(profileDirectory, 'settings.json')
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    await writeFile(settingsPath, JSON.stringify({ ...settings, autoUpdate: false }))
    instance = await launchHronaut(profileDirectory)
    const fresh = await instance.window.evaluate('window.hronaut.getState()') as { mcpTabGroups: unknown[]; savedTabGroups: unknown[]; tabs: Array<{ url: string }> }
    expect(fresh.mcpTabGroups).toEqual([])
    expect(fresh.savedTabGroups).toEqual([])
    expect(fresh.tabs.map(tab => tab.url)).toEqual(['hronaut://home/'])
    expect(await instance.app.evaluate(async ({ session }) => session.fromPartition('persist:hronaut').cookies.get({}))).toEqual([])
    await expect(access(join(profileDirectory, 'Partitions', isolatedPartition))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).not.toHaveProperty('autoUpdate')
  } finally { await closeHronaut(instance.app) }
})
