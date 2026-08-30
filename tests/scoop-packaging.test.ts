import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const read = (path: string): Promise<string> => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

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

  it('runs the Windows smoke without consuming a public release download', async () => {
    const [workflow, smoke, profile] = await Promise.all([
      read('.github/workflows/scoop-smoke.yml'),
      read('scripts/scoop-portable-smoke.ps1'),
      read('scripts/profile-smoke.ts')
    ])

    expect(workflow).toContain('runs-on: windows-latest')
    expect(workflow).not.toContain('distribution-scoop-smoke')
    expect(workflow).toContain('npx electron-builder --win portable --x64 --publish never')
    expect(workflow).toContain('./scripts/scoop-portable-smoke.ps1')
    expect(smoke).toContain('http://127.0.0.1:$assetPort/$expectedFilename')
    expect(smoke).toContain('Get-FileHash -Algorithm SHA256')
    expect(smoke).toContain('Invoke-CheckedCommand -Command $scoopCommand -Arguments @("--version")')
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
    expect(profile).toContain("typedPhase !== 'prepare'")
  })

  it('publishes the verified Scoop hash and dispatches its post-release gates', async () => {
    const [releaseWorkflow, ciWorkflow, updater] = await Promise.all([
      read('.github/workflows/release.yml'),
      read('.github/workflows/ci.yml'),
      read('scripts/update-scoop-manifest.ts')
    ])

    expect(releaseWorkflow).toContain('name: Publish verified Scoop manifest')
    expect(releaseWorkflow).toContain('Guard against a newer release on main')
    expect(releaseWorkflow).toContain('gh attestation verify release-checksums/hashes.txt')
    expect(releaseWorkflow).toContain('node scripts/update-scoop-manifest.ts "$VERSION" release-checksums/hashes.txt')
    expect(releaseWorkflow).toContain('git push origin HEAD:main')
    expect(releaseWorkflow).toContain('gh workflow run ci.yml')
    expect(releaseWorkflow).toContain('gh workflow run scoop-smoke.yml')
    expect(ciWorkflow).toMatch(/on:\n[ ]{2}workflow_dispatch:/)
    expect(updater).toContain('Expected exactly one checksum')
    expect(updater).toContain('Scoop manifest URL does not match')
  })
})
