import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Invocation {
  args: string[]
  isolatedDisplays?: string
  artifactShard?: string
}

async function runSuite(environment: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hronaut-suite-runner-'))
  try {
    await mkdir(join(root, 'scripts'))
    await mkdir(join(root, 'bin'))
    await copyFile('scripts/run-integration-suite-docker.sh', join(root, 'scripts/run-integration-suite-docker.sh'))
    await writeFile(join(root, 'scripts/verify-dependency-manifest.ts'), '')
    await writeFile(join(root, 'bin/npm'), `#!${process.execPath}
const { appendFileSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync('calls.jsonl', JSON.stringify({ args, isolatedDisplays: process.env.HRONAUT_TEST_ISOLATED_DISPLAYS, artifactShard: process.env.HRONAUT_TEST_SHARD }) + '\\n');
if (args.includes('--shard=8/8') && process.env.TEST_CAPTURE_STALL === '1') writeFileSync(process.env.HRONAUT_CONTINUITY_RESIZE_STOP_FILE, 'captured');
if (args.includes('--repeat-each=20')) process.exit(Number(process.env.TEST_DIAGNOSTIC_STATUS || 0));
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
        HRONAUT_INTEGRATION_SHARD_WORKERS: '1',
        HRONAUT_INTEGRATION_RUN_DIALOGS: 'true',
        HRONAUT_INTEGRATION_SKIP_TYPECHECK: 'false',
        ...environment
      }
    })
    if (result.error) throw result.error
    const source = await readFile(join(root, 'calls.jsonl'), 'utf8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    })
    const calls = source.trim().split('\n').filter(Boolean)
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
      ['run', 'test:integration:run', '--', '--shard=2/5', '--workers=1']
    ])
  })

  it('shares a hosted shard between two independently displayed workers', async () => {
    const { status, calls } = await runSuite({
      HRONAUT_INTEGRATION_SHARD: '5/5',
      HRONAUT_INTEGRATION_SHARD_WORKERS: '2'
    })
    expect(status).toBe(0)
    expect(calls[1]).toMatchObject({
      args: ['run', 'test:integration:run', '--', '--shard=5/5', '--workers=2'],
      isolatedDisplays: '1'
    })
    expect(calls[2]?.args).toEqual(['run', 'test:integration:dialogs:headless'])
  })

  it.each(['0', '2x', '1.5', '9'])('rejects invalid hosted worker count %s before building', async workers => {
    const { status, calls } = await runSuite({ HRONAUT_INTEGRATION_SHARD_WORKERS: workers })
    expect(status).toBe(2)
    expect(calls).toEqual([])
  })

  it('fails the gate and skips dialogs when the worker pool fails', async () => {
    const { status, calls } = await runSuite({ TEST_ELECTRON_STATUS: '1' })
    expect(status).toBe(1)
    expect(calls.some(call => call.args.includes('test:integration:dialogs:headless'))).toBe(false)
  })
  it.each([['0', '0', 0], ['1', '0', 1], ['0', '1', 1]] as const)(
    'keeps shard failure %s and diagnostic failure %s authoritative', async (original, diagnostic, expected) => {
      const { status, calls } = await runSuite({ HRONAUT_INTEGRATION_SHARD: '8/8',
        HRONAUT_INTEGRATION_RUN_DIALOGS: 'false', HRONAUT_CONTINUITY_RESIZE_DIAGNOSTICS: 'true',
        TEST_ELECTRON_STATUS: original, TEST_DIAGNOSTIC_STATUS: diagnostic })
      expect(status).toBe(expected)
      expect(calls[1]?.args).toContain('--shard=8/8')
      if (original !== '0') {
        expect(calls).toHaveLength(2)
        return
      }
      expect(calls[2]).toMatchObject({ isolatedDisplays: '1', artifactShard: 'continuity-resize-diagnostic',
        args: ['run', 'test:integration:run', '--', 'tests/integration/workspace-continuity.e2e.ts',
          '--grep', 'blocks a resumed write', '--workers=1', '--repeat-each=20', '--retries=0', '--max-failures=1'] })
    }
  )

  it('stops extra experiments after a captured stall even if the original oracle eventually passes', async () => {
    const { status, calls } = await runSuite({ HRONAUT_INTEGRATION_SHARD: '8/8',
      HRONAUT_INTEGRATION_RUN_DIALOGS: 'false', HRONAUT_CONTINUITY_RESIZE_DIAGNOSTICS: 'true', TEST_CAPTURE_STALL: '1' })
    expect(status).toBe(0)
    expect(calls).toHaveLength(2)
  })

})
