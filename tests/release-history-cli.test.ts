import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
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
