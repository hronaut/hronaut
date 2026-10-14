import { createHash } from 'node:crypto'
import { readFile, writeFile, access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'
import { seedWorkspaceProfile } from './workspace-profile.js'
import { launchRejected, quitNotice, type Scope } from './workspace-metadata-fixtures.js'

async function partitionBytes(path: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function walk(relative: string): Promise<void> {
    for (const entry of await readdir(join(path, relative), { withFileTypes: true })) {
      const name = join(relative, entry.name)
      if (entry.isDirectory()) await walk(name)
      else if (entry.isFile()) result[name] = createHash('sha256').update(await readFile(join(path, name))).digest('hex')
    }
  }
  await walk('')
  return result
}

for (const mode of ['legacy', 'current'] as const) test(`validates ${mode} metadata before obsolete Chromium profile cleanup`, async ({ profileDirectory, mcpPort }) => {
  await seedWorkspaceProfile(profileDirectory)
  const instance = await launchHronaut(profileDirectory, mcpPort)
  const isolatedPartition = 'hronaut-workspace-77777777-1111-4111-8111-111111111111'
  try {
    await instance.app.evaluate(async ({ session }, isolatedPartition) => {
      for (const name of ['hronaut', isolatedPartition]) {
        const profile = session.fromPartition(`persist:${name}`)
        await profile.cookies.set({ url: 'https://obsolete.example', name: 'obsolete-cookie', value: 'retained', expirationDate: Math.floor(Date.now() / 1000) + 3600 })
        await profile.cookies.flushStore()
      }
    }, isolatedPartition)
  } finally { await closeHronaut(instance.app) }
  const tabsPath = join(profileDirectory, 'tabs.json')
  const state = JSON.parse(await readFile(tabsPath, 'utf8'))
  if (mode === 'legacy') state.version = 2
  const bytes = JSON.stringify(state)
  await writeFile(tabsPath, bytes)
  const sharedPath = join(profileDirectory, 'Partitions', 'hronaut')
  const isolatedPath = join(profileDirectory, 'Partitions', isolatedPartition)
  const before = await Promise.all([partitionBytes(sharedPath), partitionBytes(isolatedPath)])
  expect(Object.keys(before[0]!)).not.toHaveLength(0)
  expect(Object.keys(before[1]!)).not.toHaveLength(0)
  const settingsPath = join(profileDirectory, 'settings.json')
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
  await writeFile(settingsPath, JSON.stringify({ ...settings, autoUpdate: false }))
  if (mode === 'legacy') {
    const app = await launchRejected(profileDirectory, mcpPort)
    try {
      await expect.poll(() => app.evaluate(() => Boolean((globalThis as Scope).metadataFixture.notice))).toBe(true)
      const notice = await app.evaluate(() => (globalThis as Scope).metadataFixture.notice!)
      expect(notice.buttons).toEqual(['Quit'])
      expect(notice.message).toContain('Startup stopped')
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
      await expect(fetch(`http://127.0.0.1:${mcpPort}/mcp`)).rejects.toThrow()
      expect(await readFile(tabsPath, 'utf8')).toBe(bytes)
      expect(await Promise.all([partitionBytes(sharedPath), partitionBytes(isolatedPath)])).toEqual(before)
      await quitNotice(app)
      expect(await readFile(tabsPath, 'utf8')).toBe(bytes)
      expect(await Promise.all([partitionBytes(sharedPath), partitionBytes(isolatedPath)])).toEqual(before)
    } finally { await app.close().catch(() => undefined) }
  } else {
    const accepted = await launchHronaut(profileDirectory, mcpPort)
    try {
      expect(await accepted.app.evaluate(async ({ session }) => session.fromPartition('persist:hronaut').cookies.get({}))).toEqual([])
      await access(isolatedPath)
      expect(await accepted.app.evaluate(async ({ session }, name) => session.fromPartition(`persist:${name}`).cookies.get({}), isolatedPartition)).toContainEqual(expect.objectContaining({ name: 'obsolete-cookie', value: 'retained' }))
    } finally { await closeHronaut(accepted.app) }
  }
  expect(JSON.parse(await readFile(settingsPath, 'utf8'))).not.toHaveProperty('autoUpdate')
})
