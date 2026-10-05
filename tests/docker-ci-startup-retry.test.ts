import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const registryError = 'failed to solve: failed to resolve source metadata for mcr.microsoft.com/playwright: 503 Service Unavailable'

describe('CI Docker startup recovery', () => {
  it.skipIf(process.platform === 'win32').each([
    { name: 'successful startup', failures: 0, message: '', container: true, attempts: 1, status: 0 },
    { name: 'transient registry outage', failures: 1, message: registryError, container: false, attempts: 2, status: 0 },
    { name: 'persistent registry outage', failures: 4, message: registryError, container: false, attempts: 3, status: 17 },
    { name: 'failed build command', failures: 1, message: 'RUN npm ci failed: exit code 1', container: false, attempts: 1, status: 17 },
    { name: 'registry authentication failure', failures: 1, message: 'failed to resolve source metadata: 401 Unauthorized', container: false, attempts: 1, status: 17 },
    { name: 'test HTTP failure', failures: 1, message: 'Expected 200, received 503 Service Unavailable', container: true, attempts: 1, status: 17 },
    { name: 'container failure quoting registry output', failures: 1, message: registryError, container: true, attempts: 1, status: 17 }
  ].map(scenario => ({ ...scenario, local: false, copySuccess: false })).concat([
    { name: 'local success', failures: 0, message: '', container: true, attempts: 1, status: 0, local: true, copySuccess: false },
    { name: 'local failure preserves artifacts', failures: 1, message: 'Test failed', container: true, attempts: 1, status: 17, local: true, copySuccess: true },
    { name: 'local extraction failure preserves exit status and cleanup', failures: 1, message: 'Test failed', container: true, attempts: 1, status: 17, local: true, copySuccess: false }
  ]))('$name', scenario => {
    const directory = mkdtempSync(join(tmpdir(), 'hronaut-ci-startup-'))
    try {
      const bin = join(directory, 'bin')
      mkdirSync(bin)
      writeFileSync(join(directory, 'scenario.json'), JSON.stringify(scenario))
      writeFileSync(join(directory, 'calls.jsonl'), '')
      mkdirSync(join(directory, 'artifact-fixture'))
      writeFileSync(join(directory, 'artifact-fixture/proof.txt'), 'retained failure')
      const docker = join(bin, 'docker')
      writeFileSync(docker, `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const scenario = JSON.parse(readFileSync('scenario.json', 'utf8'));
const args = process.argv.slice(2);
appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
if (args[0] === 'compose') {
  if (scenario.local && scenario.copySuccess) {
    // Simulate old evidence from a prior run whose container PID was reused.
    const oldDirectory = 'test-results/local-docker-' + args[args.indexOf('--name') + 1];
    mkdirSync(oldDirectory, { recursive: true });
    writeFileSync(oldDirectory + '/proof.txt', 'old evidence');
    writeFileSync('old-directory', oldDirectory);
  }
  writeFileSync('mode.json', JSON.stringify({ workers: process.env.HRONAUT_INTEGRATION_SHARDS, skipTypecheck: process.env.HRONAUT_INTEGRATION_SKIP_TYPECHECK }));
  const attempts = readFileSync('calls.jsonl', 'utf8').trim().split('\\n')
    .map(line => JSON.parse(line)).filter(call => call[0] === 'compose').length;
  if (attempts <= scenario.failures) {
    console.error(scenario.message);
    process.exit(17);
  }
}
if (args[0] === 'inspect') process.exit(scenario.container ? 0 : 1);
if (args[0] === 'cp') {
  if (!scenario.copySuccess) process.exit(1);
  process.exit(spawnSync('tar', ['-cf', '-', '-C', 'artifact-fixture', 'proof.txt'], { stdio: 'inherit' }).status);
}
`)
      chmodSync(docker, 0o755)
      const sleep = join(bin, 'sleep')
      writeFileSync(sleep, '#!/usr/bin/env bash\necho "$1" >> delays\n')
      chmodSync(sleep, 0o755)
      const result = spawnSync('bash', [resolve('scripts/run-integration-ci.sh'), ...(scenario.local ? ['--local'] : [])], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env, PATH: `${bin}:${process.env.PATH}`, HRONAUT_INTEGRATION_IMAGE_PREBUILT: 'false',
          HRONAUT_INTEGRATION_SHARDS: undefined, HRONAUT_INTEGRATION_SKIP_TYPECHECK: undefined
        }
      })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stdout + result.stderr).toBe(scenario.status)
      const calls = readFileSync(join(directory, 'calls.jsonl'), 'utf8').trim().split('\n')
        .map(line => JSON.parse(line) as string[])
      const runs = calls.filter(call => call[0] === 'compose')
      expect(runs).toHaveLength(scenario.attempts)
      const firstRun = runs[0]
      if (!firstRun) throw new Error('Expected a Docker Compose invocation')
      expect(runs.every(call => call.includes('--build'))).toBe(true)
      expect(runs.every(call => !call.includes('--rm'))).toBe(true)
      expect(JSON.parse(readFileSync(join(directory, 'mode.json'), 'utf8'))).toEqual({
        workers: scenario.local ? '4' : '2', skipTypecheck: scenario.local ? 'false' : 'true'
      })
      expect(calls.filter(call => call[0] === 'cp')).toHaveLength(scenario.status !== 0 && scenario.container ? 2 : 0)
      expect(calls.at(-1)).toEqual(['rm', '--force', firstRun[firstRun.indexOf('--name') + 1]])
      if (scenario.copySuccess) {
        const artifactPath = result.stdout.match(/Failure artifacts: (.+)/)?.[1]
        expect(artifactPath).toMatch(/^test-results\/local-docker-/)
        expect(readFileSync(join(directory, artifactPath!, 'proof.txt'), 'utf8')).toBe('retained failure')
        const oldDirectory = readFileSync(join(directory, 'old-directory'), 'utf8')
        expect(artifactPath).not.toBe(oldDirectory)
        expect(readFileSync(join(directory, oldDirectory, 'proof.txt'), 'utf8')).toBe('old evidence')
      }
      if (scenario.attempts > 1) {
        expect(readFileSync(join(directory, 'delays'), 'utf8')).toBe(scenario.attempts === 2 ? '5\n' : '5\n10\n')
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
