import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

it('reports release-history usage instead of silently succeeding through a directory alias', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-history-cli-'))
  try {
    const alias = join(directory, 'scripts alias')
    await symlink(resolve('scripts'), alias, process.platform === 'win32' ? 'junction' : 'dir')
    for (const entry of [resolve('scripts/release-history.ts'), join(alias, 'release-history.ts')]) {
      const result = spawnSync(process.execPath, [entry], { encoding: 'utf8', timeout: 10_000 })
      expect(result.error).toBeUndefined()
      expect(result.status, entry).toBe(1)
      expect(result.stderr).toContain('Usage: release-history.ts VERSION RELEASE_NOTES OUTPUT_JSON')
      expect(result.stdout).toBe('')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('uses the supplied immutable timestamp for generated release history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-history-time-'))
  try {
    const notes = join(directory, 'notes.md')
    const output = join(directory, 'history.json')
    const preload = join(directory, 'fetch.mjs')
    await writeFile(notes, 'Stable release notes')
    await writeFile(preload, 'globalThis.fetch = async () => Response.json([])')
    const generatedAt = '2026-10-03T21:35:00+00:00'
    const run = () => spawnSync(process.execPath, [
      '--import', preload, resolve('scripts/release-history.ts'), '2.13.2', notes, output, generatedAt
    ], { encoding: 'utf8', timeout: 10_000 })
    expect(run().status).toBe(0)
    const first = await readFile(output, 'utf8')
    expect(JSON.parse(first).generatedAt).toBe('2026-10-03T21:35:00.000Z')
    expect(run().status).toBe(0)
    expect(await readFile(output, 'utf8')).toBe(first)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
