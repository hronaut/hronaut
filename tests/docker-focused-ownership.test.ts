import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('focused Docker output ownership', () => {
  it.skipIf(process.platform !== 'linux').each([0, 1])('repairs the generated cache after test exit %s', exitCode => {
    const directory = mkdtempSync(join(tmpdir(), 'hronaut-docker-ownership-'))
    try {
      cpSync('scripts', join(directory, 'scripts'), { recursive: true })
      for (const file of ['package.json', 'package-lock.json', 'Dockerfile.test']) copyFileSync(file, join(directory, file))
      mkdirSync(join(directory, '.cache/hronaut'), { recursive: true })
      writeFileSync(join(directory, '.cache/hronaut/focused-build-app.sha256'), 'cached build')
      mkdirSync(join(directory, 'bin'))
      const docker = join(directory, 'bin/docker')
      writeFileSync(docker, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.HRONAUT_DOCKER_TEST_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'compose' && args.includes('run')) process.exit(Number(process.env.HRONAUT_DOCKER_TEST_EXIT));
`)
      chmodSync(docker, 0o755)
      const log = join(directory, 'docker.jsonl')
      const result = spawnSync(process.execPath, [resolve('scripts/run-focused-docker.ts'), 'integration', 'fixture.e2e.ts'], {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
          HRONAUT_DOCKER_TEST_LOG: log,
          HRONAUT_DOCKER_TEST_EXIT: String(exitCode)
        }
      })
      expect(result.status, result.stderr).toBe(exitCode)
      const commands = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[])
      const repair = commands.find(args => args.includes('chown'))
      expect(repair).toEqual(expect.arrayContaining([
        'chown', '-R', `${process.getuid!()}:${process.getgid!()}`, '/workspace/.cache'
      ]))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
