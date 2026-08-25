import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const read = (path: string): Promise<string> => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

describe('Scoop package QA', () => {
  it('keeps the candidate manifest aligned with the current portable release', async () => {
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
    const filename = `hronaut-${packageJson.version}-x64-windows-portable.exe`

    expect(manifest.version).toBe(packageJson.version)
    expect(manifest.license).toBe(packageJson.license)
    expect(manifest.architecture['64bit'].url).toBe(
      `https://github.com/hronaut/hronaut/releases/download/v${packageJson.version}/${filename}`
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
    expect(workflow).toContain('npx electron-builder --win portable --x64 --publish never')
    expect(workflow).toContain('./scripts/scoop-portable-smoke.ps1')
    expect(smoke).toContain('http://127.0.0.1:$assetPort/$expectedFilename')
    expect(smoke).toContain('Get-FileHash -Algorithm SHA256')
    expect(smoke).toContain('-Filter "tabs.json" -File -Recurse')
    expect(smoke).toContain('scripts/profile-smoke.ts\", \"write\"')
    expect(smoke).toContain('scripts/profile-smoke.ts\", \"read\"')
    expect(smoke).toContain('scripts/mcp-smoke.ts')
    expect(smoke).toContain('uninstall\", \"hronaut\"')
    expect(profile).toContain('...(token ? { requestInit:')
  })
})
