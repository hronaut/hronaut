import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string): Promise<string> => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const gitEnvironment = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }

function git(directory: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8', env: gitEnvironment, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

async function commitFiles(directory: string, files: Record<string, string>, message: string): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(directory, path, '..'), { recursive: true })
    await writeFile(join(directory, path), contents)
  }
  git(directory, 'add', '.')
  git(directory, '-c', 'user.name=Release test', '-c', 'user.email=release@example.invalid', 'commit', '--no-gpg-sign', '-m', message)
}

// Runs the release workflow's manifest push step in a checkout of a local bare
// "origin", after another clone has moved main the way a merge during a release does.
async function pushManifestAfterConcurrentMerge(concurrent?: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'hronaut-scoop-push-'))
  try {
    const origin = join(root, 'origin.git')
    const seed = join(root, 'seed')
    const checkout = join(root, 'checkout')
    const other = join(root, 'other')
    git(root, 'init', '--bare', '--initial-branch=main', origin)
    git(root, 'clone', origin, seed)
    await commitFiles(seed, { 'package.json': '{"version":"2.44.0"}\n', 'packaging/scoop/hronaut.json': '{"version":"2.43.0"}\n' }, 'Release 2.44.0')
    git(seed, 'push', 'origin', 'HEAD:main')
    git(root, 'clone', origin, checkout)
    await writeFile(join(checkout, 'packaging/scoop/hronaut.json'), '{"version":"2.44.0"}\n')
    if (concurrent) {
      git(root, 'clone', origin, other)
      await commitFiles(other, concurrent, 'Concurrent merge')
      git(other, 'push', 'origin', 'HEAD:main')
    }

    const workflow = await read('.github/workflows/release.yml')
    const step = workflow.split('      - name: Push the verified manifest\n')[1]?.split('\n      - name:')[0]
    const run = step?.split('        run: |\n')[1]
    if (!run) throw new Error('Scoop manifest push shell was not found')
    const script = run.split('\n').map(line => line.replace(/^ {10}/, '')).join('\n')
    const output = join(root, 'step-output')
    const result = spawnSync('bash', ['-c', script], {
      cwd: checkout,
      encoding: 'utf8',
      env: { ...gitEnvironment, VERSION: '2.44.0', GITHUB_OUTPUT: output }
    })
    return {
      status: result.status,
      stderr: result.stderr,
      output: await readFile(output, 'utf8').catch(() => ''),
      subjects: git(origin, 'log', '--format=%s', 'main').split('\n'),
      manifest: git(origin, 'show', 'main:packaging/scoop/hronaut.json')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('Scoop package QA', () => {
  it('documents the verified Scoop install path without pinning a release', async () => {
    const readme = await read('README.md')
    const command = 'scoop install https://raw.githubusercontent.com/hronaut/hronaut/main/packaging/scoop/hronaut.json'

    expect(readme).toContain('Windows x64')
    expect(readme).toContain('verified portable build and Start Menu shortcut')
    expect(readme).toContain(command)
    expect(readme).toMatch(/Windows binary remains unsigned/i)
    expect(command).not.toMatch(/v\d+\.\d+\.\d+/)
  })

  it('keeps the last published manifest internally consistent during release preparation', async () => {
    const [packageSource, manifestSource] = await Promise.all([
      read('package.json'),
      read('packaging/scoop/hronaut.json')
    ])
    const packageJson = JSON.parse(packageSource) as { version: string; license: string }
    const manifest = JSON.parse(manifestSource) as {
      version: string
      license: string
      notes: string
      architecture: { '64bit': { url: string; hash: string } }
      shortcuts: string[][]
    }
    const filename = `hronaut-${manifest.version}-x64-windows-portable.exe`

    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(manifest.license).toBe(packageJson.license)
    expect(manifest.architecture['64bit'].url).toBe(
      `https://github.com/hronaut/hronaut/releases/download/v${manifest.version}/${filename}`
    )
    expect(manifest.architecture['64bit'].hash).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.shortcuts).toEqual([[filename, 'Hronaut']])
    expect(manifest.notes).toMatch(/not code-signed/i)
  })

  it('retains local-build smoke coverage for development runs', async () => {
    const [workflow, smoke, profile, packageManifest] = await Promise.all([
      read('.github/workflows/scoop-smoke.yml'),
      read('scripts/scoop-portable-smoke.ps1'),
      read('scripts/profile-smoke.ts'),
      read('package.json')
    ])

    expect(workflow).toContain('runs-on: windows-latest')
    expect(workflow).not.toContain('distribution-scoop-smoke')
    expect(workflow).toContain("if: inputs.release-tag == ''")
    expect(workflow).toContain('npx electron-builder --win portable --x64 --publish never')
    expect(workflow).toContain('./scripts/scoop-portable-smoke.ps1')
    expect(smoke).toContain('http://127.0.0.1:$assetPort/$expectedFilename')
    expect(smoke).toContain('Get-FileHash -Algorithm SHA256')
    expect(smoke).toContain('Invoke-CheckedCommand -Command $scoopCommand -Arguments @("--version")')
    for (const client of ['scripts/profile-smoke.ts', 'scripts/mcp-smoke.ts']) {
      const source = await read(client)
      expect(source).toContain('await transport.terminateSession()')
      expect(source.indexOf('await transport.terminateSession()')).toBeLessThan(source.lastIndexOf('await client.close()'))
    }
    expect(smoke).toContain('-Path $originalAppData -Filter "tabs.json" -File -Recurse')
    expect(smoke).toContain("-match 'Profile smoke'")
    expect(smoke).toContain('scripts/profile-smoke.ts\", \"prepare\"')
    expect(smoke).toContain('if (Test-Path $settingsPath)')
    expect(smoke).toContain('Add-Member -NotePropertyName \"mcpToolSet\" -NotePropertyValue \"complete\" -Force')
    expect(smoke).toContain('scripts/profile-smoke.ts\", \"write\"')
    expect(smoke).toContain('scripts/profile-smoke.ts\", \"read\"')
    expect(smoke).toContain('scripts/mcp-smoke.ts')
    expect(smoke).toContain('Wait-ForPackageProcessExit -Executable $Executable')
    expect(smoke).toContain('uninstall\", \"hronaut\"')
    expect(profile).toContain('...(token ? { requestInit:')
    expect(profile).toContain("type ProfilePhase = 'prepare' | 'write' | 'read' | 'cleanup'")
    expect(profile).toContain("typedPhase === 'prepare'")
    expect(profile).toContain("join(tmpdir(), `hronaut-profile-smoke-${endpoint.port}.json`)")
    expect(JSON.parse(packageManifest).scripts['smoke:profile:prepare']).toBe('node scripts/profile-smoke.ts prepare')
  })

  it('checks the published executable before the release-triggered Scoop exercise', async () => {
    const [workflow, downloader, release] = await Promise.all([
      read('.github/workflows/scoop-smoke.yml'),
      read('scripts/download-scoop-release.ps1'),
      read('.github/workflows/release.yml')
    ])
    expect(release).toContain('-f "release-tag=v$VERSION"')
    expect(workflow).toContain("if: inputs.release-tag != ''")
    expect(workflow).toContain('RELEASE_TAG: ${{ inputs.release-tag }}')
    expect(workflow.indexOf('./scripts/download-scoop-release.ps1')).toBeLessThan(workflow.indexOf('./scripts/scoop-portable-smoke.ps1'))
    expect(downloader).toContain('$manifest.version -cne $package.version')
    expect(downloader).toContain('$release.isDraft -or $release.isPrerelease')
    expect(downloader).toContain('gh release download $Tag --repo hronaut/hronaut --pattern $filename')
    expect(downloader).toContain("$actualHash -cne $manifest.architecture.'64bit'.hash")
    expect(downloader).toContain('gh attestation verify $artifact --repo hronaut/hronaut --signer-workflow hronaut/hronaut/.github/workflows/release.yml')
    expect(downloader).not.toContain('--clobber')
  })

  it('publishes the verified Scoop hash and dispatches its dedicated package gate', async () => {
    const [releaseWorkflow, ciWorkflow, updater] = await Promise.all([
      read('.github/workflows/release.yml'),
      read('.github/workflows/ci.yml'),
      read('scripts/update-scoop-manifest.ts')
    ])

    expect(releaseWorkflow).toContain('name: Publish verified Scoop manifest')
    expect(releaseWorkflow).toContain('Guard against a newer release on main')
    expect(releaseWorkflow).toContain('gh attestation verify release-checksums/hashes.txt')
    const updateStep = releaseWorkflow.split('      - name: Update and test the Scoop manifest\n')[1]
      ?.split('      - name: Push the verified manifest\n')[0]
    expect(updateStep).toContain('node scripts/update-scoop-manifest.ts "$VERSION" release-checksums/hashes.txt')
    expect(updateStep).toContain('npm ci --ignore-scripts')
    expect(releaseWorkflow).toContain('git push origin HEAD:main')
    expect(releaseWorkflow).not.toContain('gh workflow run ci.yml')
    expect(releaseWorkflow).toContain('gh workflow run scoop-smoke.yml')
    expect(ciWorkflow).toMatch(/on:\n[ ]{2}workflow_dispatch:/)
    expect(updater).toContain('Expected exactly one checksum')
    expect(updater).toContain('Scoop manifest URL does not match')
  })
})

// The production workflow runs Bash on Ubuntu; native Windows need not provide it.
describe.skipIf(process.platform === 'win32')('Scoop manifest push', () => {
  it('replays the manifest commit on a main that moved during the release', async () => {
    const result = await pushManifestAfterConcurrentMerge({ 'notes.txt': 'merged while the release ran\n' })

    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toContain('pushed=true')
    expect(result.subjects).toEqual(['Publish Scoop manifest for Hronaut 2.44.0', 'Concurrent merge', 'Release 2.44.0'])
    expect(result.manifest).toBe('{"version":"2.44.0"}')
  })

  it('leaves main alone when it moved to a newer release', async () => {
    const result = await pushManifestAfterConcurrentMerge({ 'package.json': '{"version":"2.45.0"}\n' })

    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toContain('pushed=false')
    expect(result.subjects).toEqual(['Concurrent merge', 'Release 2.44.0'])
    expect(result.manifest).toBe('{"version":"2.43.0"}')
  })

  it('pushes directly when main did not move', async () => {
    const result = await pushManifestAfterConcurrentMerge()

    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toContain('pushed=true')
    expect(result.subjects).toEqual(['Publish Scoop manifest for Hronaut 2.44.0', 'Release 2.44.0'])
  })
})
