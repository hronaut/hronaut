import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discardObsoleteBrowserData } from '../src/main/obsolete-profile-data.js'

const directories: string[] = []
const storageId = '77777777-1111-4111-8111-111111111111'
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function seed(version: number) {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-obsolete-data-'))
  directories.push(directory)
  for (const name of ['hronaut', `hronaut-workspace-${storageId}`]) {
    await mkdir(join(directory, 'Partitions', name), { recursive: true })
    await writeFile(join(directory, 'Partitions', name, 'Cookies'), 'profile cookie fixture')
  }
  await writeFile(join(directory, 'tabs.json'), JSON.stringify({ version, activeTabId: null, tabs: [], mcpTabGroups: [], savedTabGroups: [] }))
  await writeFile(join(directory, 'commercial-license.json'), 'license fixture')
  return directory
}

describe('obsolete browser data deletion', () => {
  it.each([0, 1, 2, 4])('preserves rejected metadata and every partition (version=%s)', async version => {
    const directory = await seed(version)
    const original = await readFile(join(directory, 'tabs.json'))
    await expect(discardObsoleteBrowserData(directory)).rejects.toThrow('Saved workspace metadata')
    expect(await readFile(join(directory, 'tabs.json'))).toEqual(original)
    for (const name of ['hronaut', `hronaut-workspace-${storageId}`]) {
      expect(await readFile(join(directory, 'Partitions', name, 'Cookies'), 'utf8')).toBe('profile cookie fixture')
    }
  })

  it('removes only obsolete shared storage after full current-schema acceptance', async () => {
    const directory = await seed(3)
    expect(await discardObsoleteBrowserData(directory)).toBe(true)
    await expect(readFile(join(directory, 'Partitions/hronaut/Cookies'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(directory, 'Partitions', `hronaut-workspace-${storageId}`, 'Cookies'), 'utf8')).toBe('profile cookie fixture')
  })

  it('does not treat missing metadata as permission to delete unknown storage', async () => {
    const directory = await seed(3)
    await rm(join(directory, 'tabs.json'))
    expect(await discardObsoleteBrowserData(directory)).toBe(false)
    expect(await readFile(join(directory, 'Partitions/hronaut/Cookies'), 'utf8')).toBe('profile cookie fixture')
  })
})
