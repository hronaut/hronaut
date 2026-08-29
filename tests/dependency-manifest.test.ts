import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []
const verifier = resolve('scripts/verify-dependency-manifest.ts')

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function runVerifier(packageDependencies: Record<string, string>, lockDependencies: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-dependency-manifest-'))
  temporaryDirectories.push(directory)
  await writeFile(join(directory, 'package.json'), JSON.stringify({ dependencies: packageDependencies }))
  await writeFile(join(directory, 'package-lock.json'), JSON.stringify({
    packages: { '': { dependencies: lockDependencies } }
  }))
  return spawnSync(process.execPath, [verifier], { cwd: directory, encoding: 'utf8' })
}

describe('Docker dependency manifest verification', () => {
  it('accepts matching dependency declarations', async () => {
    const result = await runVerifier({ vue: '^3.5.0' }, { vue: '^3.5.0' })
    expect(result.status).toBe(0)
  })

  it('fails closed when package.json and the lockfile disagree', async () => {
    const result = await runVerifier({ vue: '^3.6.0' }, { vue: '^3.5.0' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('disagree on dependencies')
  })
})
