import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? sourceFiles(join(directory, entry.name))
    : Promise.resolve(entry.name.endsWith('.ts') ? [join(directory, entry.name)] : [])))
  return nested.flat()
}

describe('Electron Fuses in packaged builds', () => {
  it('turns off running as Node, NODE_OPTIONS and the inspector, and loads only a checked app.asar', async () => {
    const config = parse(await readFile('electron-builder.yml', 'utf8')) as { asar?: boolean; electronFuses?: Record<string, boolean> }
    expect(config.asar).toBe(true)
    expect(config.electronFuses).toEqual({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      // Unsigned builds: the Apple Silicon binary needs a fresh ad-hoc signature after its bytes change.
      resetAdHocDarwinSignature: true
    })
  })

  it('keeps main free of what those fuses turn off', async () => {
    // With runAsNode off, process.fork and ELECTRON_RUN_AS_NODE stop working in the packaged app.
    for (const file of await sourceFiles('src/main')) {
      const source = await readFile(file, 'utf8')
      expect(source, file).not.toMatch(/ELECTRON_RUN_AS_NODE|\bfork\(|NODE_OPTIONS/u)
    }
  })

  it.each([
    ['.github/workflows/macos-native-preflight.yml', 'electron-builder --mac dir "--$PACKAGE_ARCH" --publish never -c.electronFuses.enableNodeCliInspectArguments=true'],
    // PowerShell splits an unquoted "-c.name=value" at the dot, so electron-builder read ".electronFuses..." as a config file.
    ['.github/workflows/windows-native-preflight.yml', 'electron-builder --win dir --x64 --publish never "-c.electronFuses.enableNodeCliInspectArguments=true"']
  ])('turns the inspector back on only for the Playwright-driven candidate in %s', async (workflow, build) => {
    const source = await readFile(workflow, 'utf8')
    expect(source).toContain(build)
  })

  it('leaves release packaging on the hardened fuses', async () => {
    const release = await readFile('.github/workflows/release.yml', 'utf8')
    expect(release).toContain('npx electron-builder --mac')
    expect(release).not.toContain('electronFuses')
  })
})
