import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('focused Electron build cache', () => {
  it('reuses verified output and rebuilds after input or output changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hronaut-build-cache-'))
    temporaryDirectories.push(root)
    await Promise.all([
      mkdir(join(root, 'scripts'), { recursive: true }),
      mkdir(join(root, 'src'), { recursive: true }),
      mkdir(join(root, 'build'), { recursive: true }),
      mkdir(join(root, 'bin'), { recursive: true })
    ])
    const sourceScript = await readFile('scripts/build-app-if-needed.sh', 'utf8')
    await writeFile(join(root, 'scripts/build-app-if-needed.sh'), sourceScript)
    await writeFile(join(root, 'src/index.ts'), 'export const value = 1\n')
    for (const file of ['electron.vite.config.ts', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json', 'tsconfig.web.json']) {
      await writeFile(join(root, file), '{}\n')
    }
    const fakeNpm = join(root, 'bin/npm')
    await writeFile(fakeNpm, `#!/usr/bin/env bash
set -euo pipefail
count_file=.build-count
count=0
[[ ! -f "$count_file" ]] || count="$(cat "$count_file")"
printf '%s\n' "$((count + 1))" > "$count_file"
mkdir -p out/main out/preload out/renderer
printf 'main-%s\n' "$((count + 1))" > out/main/index.js
printf 'preload\n' > out/preload/index.cjs
printf 'renderer\n' > out/renderer/index.html
`)
    await chmod(fakeNpm, 0o755)

    const run = (): string => execFileSync('bash', ['scripts/build-app-if-needed.sh'], {
      cwd: root,
      env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}` },
      encoding: 'utf8'
    })
    run()
    expect(await readFile(join(root, '.build-count'), 'utf8')).toBe('1\n')
    expect(run()).toContain('reusing out/')
    expect(await readFile(join(root, '.build-count'), 'utf8')).toBe('1\n')

    await writeFile(join(root, 'src/index.ts'), 'export const value = 2\n')
    run()
    expect(await readFile(join(root, '.build-count'), 'utf8')).toBe('2\n')

    await writeFile(join(root, 'out/main/index.js'), 'corrupt\n')
    run()
    expect(await readFile(join(root, '.build-count'), 'utf8')).toBe('3\n')
  })
})
