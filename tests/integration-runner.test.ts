import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Invocation {
  args: string[]
  isolatedDisplays?: string
}

async function runSuite(environment: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hronaut-suite-runner-'))
  try {
    await mkdir(join(root, 'scripts'))
    await mkdir(join(root, 'bin'))
    await copyFile('scripts/run-integration-suite-docker.sh', join(root, 'scripts/run-integration-suite-docker.sh'))
    await writeFile(join(root, 'scripts/verify-dependency-manifest.ts'), '')
    await writeFile(join(root, 'bin/npm'), `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync('calls.jsonl', JSON.stringify({ args, isolatedDisplays: process.env.HRONAUT_TEST_ISOLATED_DISPLAYS }) + '\\n');
if (args.includes('test:integration:run')) process.exit(Number(process.env.TEST_ELECTRON_STATUS || 0));
`)
    await writeFile(join(root, 'bin/xvfb-run'), '#!/usr/bin/env bash\nshift 2\nexec "$@"\n')
    await chmod(join(root, 'bin/npm'), 0o755)
    await chmod(join(root, 'bin/xvfb-run'), 0o755)
    const result = spawnSync('bash', ['scripts/run-integration-suite-docker.sh'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        HRONAUT_INTEGRATION_SHARDS: '4',
        HRONAUT_INTEGRATION_SHARD: '',
        HRONAUT_INTEGRATION_RUN_DIALOGS: 'true',
        HRONAUT_INTEGRATION_SKIP_TYPECHECK: 'false',
        ...environment
      }
    })
    if (result.error) throw result.error
    const calls = (await readFile(join(root, 'calls.jsonl'), 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line) as Invocation)
    return { status: result.status, calls }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe.skipIf(process.platform === 'win32')('Docker Electron scheduling', () => {
  it('shares all tests between four isolated workers after one full build', async () => {
    const { status, calls } = await runSuite()
    expect(status).toBe(0)
    expect(calls.map(call => call.args)).toEqual([
      ['run', 'build'],
      ['run', 'test:integration:run', '--', '--workers=4'],
      ['run', 'test:integration:dialogs:headless']
    ])
    expect(calls[1]?.isolatedDisplays).toBe('1')
  })

  it('preserves hosted single-shard selection and optional dialogs', async () => {
    const { status, calls } = await runSuite({
      HRONAUT_INTEGRATION_SHARD: '2/5',
      HRONAUT_INTEGRATION_RUN_DIALOGS: 'false',
      HRONAUT_INTEGRATION_SKIP_TYPECHECK: 'true'
    })
    expect(status).toBe(0)
    expect(calls.map(call => call.args)).toEqual([
      ['run', 'build:app'],
      ['run', 'test:integration:run', '--', '--shard=2/5']
    ])
  })

  it('fails the gate and skips dialogs when the worker pool fails', async () => {
    const { status, calls } = await runSuite({ TEST_ELECTRON_STATUS: '1' })
    expect(status).toBe(1)
    expect(calls.some(call => call.args.includes('test:integration:dialogs:headless'))).toBe(false)
  })
})
