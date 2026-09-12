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
  await writeFile(join(directory, 'tabs.json'), JSON.stringify({ version, mcpTabGroups: [{ storageId }], savedTabGroups: [] }))
  await writeFile(join(directory, 'commercial-license.json'), 'license fixture')
  return directory
}

describe('obsolete browser data deletion', () => {
  it('deletes obsolete partitions and tab metadata without importing them', async () => {
    const directory = await seed(2)
    await discardObsoleteBrowserData(directory)
    await discardObsoleteBrowserData(directory)
    for (const path of ['tabs.json', 'Partitions/hronaut/Cookies', `Partitions/hronaut-workspace-${storageId}/Cookies`]) {
      await expect(readFile(join(directory, path))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    expect(await readFile(join(directory, 'commercial-license.json'), 'utf8')).toBe('license fixture')
  })

  it.each([3, 4])('preserves current and unknown future isolated formats (version=%s)', async version => {
    const directory = await seed(version)
    const tabs = await readFile(join(directory, 'tabs.json'), 'utf8')
    await discardObsoleteBrowserData(directory)
    expect(await readFile(join(directory, 'tabs.json'), 'utf8')).toBe(tabs)
    expect(await readFile(join(directory, 'Partitions', `hronaut-workspace-${storageId}`, 'Cookies'), 'utf8')).toBe('profile cookie fixture')
    await expect(readFile(join(directory, 'Partitions', 'hronaut', 'Cookies'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never follows invalid storage identifiers outside the obsolete partition', async () => {
    const directory = await seed(2)
    await writeFile(join(directory, 'tabs.json'), JSON.stringify({ version: 2, mcpTabGroups: [{ storageId: '../../commercial-license.json' }] }))
    await discardObsoleteBrowserData(directory)
    expect(await readFile(join(directory, 'commercial-license.json'), 'utf8')).toBe('license fixture')
  })
})
