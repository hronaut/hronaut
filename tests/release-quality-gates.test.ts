import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

function job(source: string, name: string): string {
  const marker = `  ${name}:\n`
  const start = source.indexOf(marker)
  if (start < 0) throw new Error(`Workflow job not found: ${name}`)
  const contents = source.slice(start + marker.length)
  const nextJob = contents.search(/^ {2}[a-zA-Z0-9-]+:\n/m)
  return nextJob < 0 ? contents : contents.slice(0, nextJob)
}

const gitEnvironment = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }

function git(directory: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8', env: gitEnvironment, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

async function withVersionHistory(versions: string[], check: (directory: string, commits: string[]) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-auto-tag-'))
  try {
    git(directory, 'init', '--initial-branch=main')
    const commits: string[] = []
    for (const [index, version] of versions.entries()) {
      await writeFile(join(directory, 'package.json'), JSON.stringify({ version }))
      await writeFile(join(directory, 'notes.txt'), `Change ${index}`)
      git(directory, 'add', '.')
      git(directory, '-c', 'user.name=Release test', '-c', 'user.email=release@example.invalid', 'commit', '--no-gpg-sign', '-m', `Change ${index}`)
      commits.push(git(directory, 'rev-parse', 'HEAD'))
    }
    await check(directory, commits)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function detectVersion(directory: string, environment: Record<string, string>) {
  const workflow = await readFile('.github/workflows/auto-tag.yml', 'utf8')
  const step = workflow.split('      - name: Detect a version bump\n')[1]?.split('\n      - name:')[0]
  const run = step?.split('        run: |\n')[1]
  if (!run) throw new Error('Version detection shell was not found')
  const script = run.split('\n').map(line => line.replace(/^ {10}/, '')).join('\n')
  const output = join(directory, 'detection-output')
  const result = spawnSync('bash', ['-c', script], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...gitEnvironment, EVENT_NAME: 'push', PUSH_BEFORE: '', GITHUB_OUTPUT: output, RUNNER_TEMP: directory, ...environment }
  })
  return { status: result.status, stderr: result.stderr, stdout: result.stdout, output: await readFile(output, 'utf8').catch(() => '') }
}

// The production workflow runs Bash on Ubuntu; native Windows need not provide it.
describe.skipIf(process.platform === 'win32')('auto-tag push range', () => {
  it('detects a version bump before the final commit of a multiple-commit push', async () => {
    await withVersionHistory(['1.0.0', '1.1.0', '1.1.0'], async (directory, commits) => {
      const result = await detectVersion(directory, { PUSH_BEFORE: commits[0]! })
      expect(result.status, result.stderr).toBe(0)
      expect(result.output).toContain('should_tag=true')
      expect(result.output).toContain('tag=v1.1.0')
    })
  })

  it('skips a push whose baseline already has the current version', async () => {
    await withVersionHistory(['1.0.0', '1.1.0', '1.1.0'], async (directory, commits) => {
      const result = await detectVersion(directory, { PUSH_BEFORE: commits[1]! })
      expect(result.status, result.stderr).toBe(0)
      expect(result.output).toContain('should_tag=false')
    })
  })

  it('detects a single-commit version bump', async () => {
    await withVersionHistory(['1.0.0', '1.1.0'], async (directory, commits) => {
      const result = await detectVersion(directory, { PUSH_BEFORE: commits[0]! })
      expect(result.status, result.stderr).toBe(0)
      expect(result.output).toContain('should_tag=true')
    })
  })

  it('fetches the exact baseline outside a shallow checkout', async () => {
    await withVersionHistory(['1.0.0', '1.1.0', '1.1.0', '1.1.0'], async (directory, commits) => {
      const checkout = join(directory, 'shallow')
      git(directory, 'clone', '--depth=2', pathToFileURL(directory).href, checkout)
      expect(spawnSync('git', ['cat-file', '-e', `${commits[0]}^{commit}`], { cwd: checkout }).status).not.toBe(0)
      const result = await detectVersion(checkout, { PUSH_BEFORE: commits[0]! })
      expect(result.status, result.stderr).toBe(0)
      expect(result.output).toContain('should_tag=true')
      expect(git(checkout, 'rev-parse', 'HEAD')).toBe(commits.at(-1))
    })
  })

  it('allows explicit dispatch without a push baseline', async () => {
    await withVersionHistory(['1.1.0'], async directory => {
      const result = await detectVersion(directory, { EVENT_NAME: 'workflow_dispatch' })
      expect(result.status, result.stderr).toBe(0)
      expect(result.output).toContain('should_tag=true')
    })
  })

  it('skips a new branch without inferring a bump from its last commit', async () => {
    await withVersionHistory(['1.0.0', '1.1.0'], async directory => {
      const result = await detectVersion(directory, { PUSH_BEFORE: '0'.repeat(40) })
      expect(result.status, result.stderr).toBe(0)
      expect(result.output).toContain('should_tag=false')
      expect(result.stdout).toMatch(/new branch/i)
    })
  })

  it.each(['', 'not-a-sha', 'f'.repeat(40)])('fails clearly for missing, invalid or unavailable baseline %j', async before => {
    await withVersionHistory(['1.0.0', '1.1.0'], async directory => {
      const result = await detectVersion(directory, { PUSH_BEFORE: before })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/push baseline/i)
      expect(result.output).not.toContain('should_tag=true')
    })
  })
})

describe('release quality gates', () => {
  it('binds the checkout and baseline to the triggering event', async () => {
    const workflow = await readFile('.github/workflows/auto-tag.yml', 'utf8')
    expect(workflow).toContain('ref: ${{ github.sha }}')
    expect(workflow).toContain('PUSH_BEFORE: ${{ github.event.before }}')
  })

  it('treats a concurrently published version tag as an idempotent auto-tag success', async () => {
    const workflow = await readFile('.github/workflows/auto-tag.yml', 'utf8')
    const remoteCheck = workflow.indexOf('git ls-remote --exit-code --tags origin "refs/tags/$TAG"')
    const createTag = workflow.indexOf('git tag -a "$TAG"')

    expect(remoteCheck).toBeGreaterThanOrEqual(0)
    expect(createTag).toBeGreaterThan(remoteCheck)
  })

  it('runs the concurrent static validation gate in pull-request CI', async () => {
    const [workflow, packageSource] = await Promise.all([
      readFile('.github/workflows/ci.yml', 'utf8'),
      readFile('package.json', 'utf8')
    ])
    const validate = job(workflow, 'validate')
    const releaseCandidate = job(workflow, 'package-release-candidate')
    const packageJson = JSON.parse(packageSource) as { scripts: Record<string, string> }

    expect(validate).toContain('run: npm run validate')
    expect(validate).toContain('HRONAUT_TYPECHECK_JOBS: "1"')
    expect(validate).not.toContain('run: npm run lint')
    expect(validate).not.toContain('run: npm test')
    expect(validate).not.toContain('run: npm run build\n')
    expect(releaseCandidate).toContain('command: package:linux')
    expect(releaseCandidate).toContain('command: package:mac')
    expect(releaseCandidate).toContain('command: package:win')
    for (const platform of ['linux', 'mac', 'win']) {
      expect(packageJson.scripts[`package:${platform}`]).toContain('npm run build:app')
      expect(packageJson.scripts[`package:${platform}`]).not.toContain('npm run build &&')
    }
  })

  it('restores complete static-analysis state only after install and saves it only after validation', async () => {
    const workflow = await readFile('.github/workflows/ci.yml', 'utf8')
    const validate = job(workflow, 'validate')
    const install = validate.indexOf('name: Install dependencies')
    const restore = validate.indexOf('uses: actions/cache/restore@v6')
    const staticValidation = validate.indexOf('run: npm run validate')
    const save = validate.indexOf('uses: actions/cache/save@v6')
    const configHash = "${{ hashFiles('package-lock.json', 'package.json', 'eslint.config.mjs', 'tsconfig.json', 'tsconfig.node.json', 'tsconfig.web.json', 'tsconfig.website.json') }}"
    const cachePrefix = `static-analysis-v2-\${{ runner.os }}-node24-${configHash}`

    expect(install).toBeGreaterThanOrEqual(0)
    expect(restore).toBeGreaterThan(install)
    expect(staticValidation).toBeGreaterThan(restore)
    expect(save).toBeGreaterThan(staticValidation)
    expect(validate).toContain('if: success()')
    expect(validate).toContain(`key: ${cachePrefix}-\${{ github.sha }}`)
    expect(validate).toContain(`restore-keys: |\n            ${cachePrefix}-`)
    for (const path of [
      'node_modules/.cache/eslint',
      'tsconfig.node.tsbuildinfo',
      'tsconfig.web.tsbuildinfo',
      'tsconfig.website.tsbuildinfo'
    ]) expect(validate).toContain(path)
  })

  it('validates the immutable tag before any platform release build starts', async () => {
    const workflow = await readFile('.github/workflows/release.yml', 'utf8')
    const validate = job(workflow, 'validate')

    expect(validate).toContain('needs: prepare-release')
    expect(validate).toContain('ref: ${{ github.sha }}')
    expect(validate).toContain('run: npm run validate')
    expect(validate).not.toContain('run: npm run lint')
    expect(validate).not.toContain('run: npm test')
    expect(validate).not.toContain('run: npm run build\n')
    expect(validate).toContain('run: npm audit --omit=dev --audit-level=high')

    for (const build of ['build-linux', 'build-macos', 'build-windows']) {
      const buildJob = job(workflow, build)
      expect(buildJob).toMatch(/needs:\n(?: {6}- .+\n)* {6}- validate\n/)
      expect(buildJob).toContain('npm run build:app')
      expect(buildJob).not.toContain('npm run build\n')
    }
  })

  it('does not restore dependency caches across untrusted and privileged release jobs', async () => {
    const workflow = await readFile('.github/workflows/release.yml', 'utf8')

    expect(workflow).not.toContain('cache: npm')
    expect(workflow).not.toContain('uses: actions/cache')
  })

  it('binds release execution to the selected mainline tag and treats corrected notes as data', async () => {
    const [workflow, autoTag] = await Promise.all([
      readFile('.github/workflows/release.yml', 'utf8'),
      readFile('.github/workflows/auto-tag.yml', 'utf8')
    ])
    const prepare = job(workflow, 'prepare-release')
    const publish = job(workflow, 'publish-release')

    expect(workflow).not.toContain('inputs.tag')
    expect(workflow).not.toContain('REQUESTED_TAG')
    expect(workflow).not.toContain('needs.prepare-release.outputs.sha')
    expect(prepare).toContain('if [[ "$GITHUB_REF" != refs/tags/* ]]')
    expect(prepare).toContain('if [[ "$GITHUB_SHA" != "$tag_sha"')
    expect(prepare).toContain('git merge-base --is-ancestor "$tag_sha" origin/main')
    expect(prepare).toContain('git merge-base --is-ancestor "$notes_sha" origin/main')
    expect(prepare).toContain('git cat-file -t "$notes_object"')
    expect(prepare).toContain('git cat-file -s "$notes_object"')
    for (const name of [
      'prepare-release',
      'test-integration',
      'validate',
      'build-linux',
      'build-macos',
      'build-windows',
      'publish-release',
      'verify-public-release'
    ]) expect(job(workflow, name)).toContain('ref: ${{ github.sha }}')
    expect(publish).not.toContain('ref: ${{ needs.prepare-release.outputs.notes_sha }}')
    expect(publish).toContain('git show "$NOTES_SHA:CHANGELOG.md" > "$RUNNER_TEMP/hronaut-release-CHANGELOG.md"')
    expect(autoTag).toContain('gh workflow run release.yml --ref "$TAG"')
    expect(autoTag).not.toContain('-f tag="$TAG"')
  })

  it('keeps published release notes focused on changes and the artifact warning', async () => {
    const [workflow, generator] = await Promise.all([
      readFile('.github/workflows/release.yml', 'utf8'),
      readFile('scripts/release-notes.ts', 'utf8')
    ])
    const warningStart = generator.indexOf('<!-- unsigned-release-warning -->')
    const changesStart = generator.indexOf("## What's changed")
    const unsignedWarning = generator.slice(warningStart, changesStart)

    expect(workflow).toContain('node scripts/release-notes.ts "$VERSION" "$RUNNER_TEMP/hronaut-release-CHANGELOG.md" current-release-notes.md')
    for (const source of [workflow, generator]) {
      expect(source).not.toContain("echo '## Start here'")
      expect(source).not.toContain('Watch the 35-second product demo')
      expect(source).not.toContain('Choose the right Windows, macOS, or Linux package')
      expect(source).not.toContain('Connect Codex, Claude Code, Gemini CLI')
      expect(source).not.toContain('Permitted noncommercial use is free')
    }
    expect(warningStart).toBeGreaterThanOrEqual(0)
    expect(unsignedWarning).toContain('https://hronaut.dev/security#verify-release')
    expect(warningStart).toBeLessThan(changesStart)
  })

  it('verifies hronaut.dev has resolved every published release and download', async () => {
    const workflow = await readFile('.github/workflows/release.yml', 'utf8')
    const verification = job(workflow, 'verify-public-release')

    expect(verification).toContain('- publish-release')
    expect(verification).toContain('ref: ${{ github.sha }}')
    expect(verification).toContain('VERSION: ${{ needs.prepare-release.outputs.version }}')
    expect(verification).toContain('run: node scripts/verify-public-release.ts "$VERSION"')
  })

  it('uploads only regular release files when a rerun still has failure diagnostics', async () => {
    const workflow = await readFile('.github/workflows/release.yml', 'utf8')
    const publish = job(workflow, 'publish-release')

    expect(publish).toContain("find release-assets -maxdepth 1 -type f -print0")
    expect(publish).toContain('node scripts/release-asset-labels.ts "${release_files[@]}"')
    expect(publish).toContain("mapfile -d '' release_upload_files")
    expect(publish.match(/gh release upload/gu)).toHaveLength(1)
    expect(publish).toContain('gh release upload "$TAG" "${release_upload_files[@]}" --repo "$GITHUB_REPOSITORY" --clobber')
    expect(publish).not.toContain('gh release upload "$TAG" release-assets/*')
    expect(publish.indexOf('gh release upload')).toBeLessThan(publish.indexOf('gh release edit "$TAG" --repo "$GITHUB_REPOSITORY" --draft=false'))
  })

  it('retains bounded Playwright diagnostics when Docker integration fails', async () => {
    const [ciWorkflow, releaseWorkflow, runner, playwright] = await Promise.all([
      readFile('.github/workflows/ci.yml', 'utf8'),
      readFile('.github/workflows/release.yml', 'utf8'),
      readFile('scripts/run-integration-ci.sh', 'utf8'),
      readFile('playwright.config.ts', 'utf8')
    ])

    for (const integration of [job(ciWorkflow, 'integration-shard'), job(releaseWorkflow, 'test-integration')]) {
      expect(integration).toContain('run: bash scripts/run-integration-ci.sh')
      expect(integration).not.toContain('docker/build-push-action')
      expect(integration).not.toContain('type=gha,scope=hronaut-integration')
      expect(integration).not.toContain('HRONAUT_INTEGRATION_IMAGE_PREBUILT')
      expect(integration).toContain('if: failure()')
      expect(integration).toContain('uses: actions/upload-artifact@v7')
      expect(integration).toContain('path: ci-artifacts/')
      expect(integration).toContain('retention-days: 7')
    }
    expect(playwright).toContain('retries: process.env.CI ? 1 : 0')
    expect(playwright).toContain('failOnFlakyTests: Boolean(process.env.CI)')
    expect(playwright).toContain("trace: process.env.CI ? 'on-first-retry' : 'off'")
    expect(runner).toContain('compose_build_arguments+=(--build)')
    expect(runner).not.toContain('--no-build')
    expect(runner).toContain('docker compose --file compose.test.ci.yaml run "${compose_build_arguments[@]}" --name "$container_name" integration')
    expect(runner).toContain('docker cp "$container_name:/workspace/$source_directory" - | tar -xf - -C "$artifact_directory"')
    expect(runner).toContain('docker rm --force "$container_name"')
    expect(runner).not.toContain('run --build --rm integration')
  })

  it('keeps wallet documentation in the website public source before output cleanup', async () => {
    const [config, publicWallets, builtWallets] = await Promise.all([
      readFile('vite.website.config.ts', 'utf8'),
      readFile('website/public/WALLETS.md', 'utf8'),
      readFile('docs/WALLETS.md', 'utf8')
    ])

    expect(config).toContain("root: 'website'")
    expect(config).toContain("outDir: '../docs'")
    expect(config).toContain('emptyOutDir: true')
    expect(publicWallets).toBe(builtWallets)
  })

  it('keeps the reference aligned with the implemented local-wallet trust model', async () => {
    const reference = await readFile('REFERENCE.md', 'utf8')

    expect(reference).toContain('## Local Web3 wallets')
    expect(reference).toContain('[wallet security and usage reference](docs/WALLETS.md)')
    expect(reference).toContain('Mainnet defaults to explicit human approval')
    expect(reference).toContain('Bypass Approve')
    expect(reference).toContain('does not integrate WalletConnect, Reown, or external-wallet SDKs')
    expect(reference).not.toContain('external-wallet signing')
    expect(reference).not.toContain('design/web3-wallet-architecture.md')
  })
})
