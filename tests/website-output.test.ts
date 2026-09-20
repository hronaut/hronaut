import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareWebsiteOutput } from '../scripts/prepare-website-output.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    recursive: true,
    force: true
  })))
})

describe('website output preparation', () => {
  it('removes generated bundles without deleting authored documentation', async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'hronaut-website-output-'))
    temporaryDirectories.push(repositoryRoot)
    const documentationDirectory = join(repositoryRoot, 'docs')
    const assetsDirectory = join(documentationDirectory, 'assets')
    await mkdir(assetsDirectory, { recursive: true })
    await Promise.all([
      writeFile(join(documentationDirectory, 'REFERENCE.md'), 'authored reference\n'),
      writeFile(join(documentationDirectory, 'index.html'), 'stale website\n'),
      writeFile(join(assetsDirectory, 'stale.js'), 'stale bundle\n')
    ])

    await prepareWebsiteOutput(repositoryRoot)

    await expect(readFile(join(documentationDirectory, 'REFERENCE.md'), 'utf8'))
      .resolves.toBe('authored reference\n')
    await expect(stat(join(documentationDirectory, 'index.html'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(assetsDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
