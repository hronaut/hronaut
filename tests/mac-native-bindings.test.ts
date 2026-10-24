import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import {
  installMacPackages,
  matchesIntegrity,
  missingMacPackages,
  shippedMacPackages,
  type InstallHost,
  type LockedMacPackage
} from '../scripts/mac-native-bindings.ts'

const integrityOf = (bytes: Uint8Array): string => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'hronaut-mac-bindings-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('the macOS native packages the app ships', () => {
  it('are argon2 for Intel and Apple silicon in this package-lock.json, pinned with their tarball and integrity', async () => {
    const lock = JSON.parse(await readFile('package-lock.json', 'utf8')) as Parameters<typeof shippedMacPackages>[0]
    const shipped = shippedMacPackages(lock)
    expect(shipped.map(({ path, arch }) => [path, arch])).toEqual(expect.arrayContaining([
      ['node_modules/@node-rs/argon2-darwin-x64', 'x64'],
      ['node_modules/@node-rs/argon2-darwin-arm64', 'arm64']
    ]))
    for (const locked of shipped) {
      expect(locked.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//u)
      expect(locked.integrity).toMatch(/^sha512-/u)
    }
  })

  it('leave out development tools, packages for both CPUs and those for other systems, and refuse an unpinned one', () => {
    const pinned = { version: '1.0.0', resolved: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz', integrity: 'sha512-AA==' }
    const lock = {
      packages: {
        '': { name: 'hronaut' },
        'node_modules/@esbuild/darwin-x64': { ...pinned, dev: true, os: ['darwin'], cpu: ['x64'] },
        'node_modules/universal-darwin': { ...pinned, os: ['darwin'], cpu: ['x64', 'arm64'] },
        'node_modules/any-cpu-darwin': { ...pinned, os: ['darwin'] },
        'node_modules/binding-linux-x64': { ...pinned, os: ['linux'], cpu: ['x64'] },
        'node_modules/binding-darwin-arm64': { ...pinned, os: ['darwin'], cpu: ['arm64'] }
      }
    }
    expect(shippedMacPackages(lock)).toEqual([{ path: 'node_modules/binding-darwin-arm64', arch: 'arm64', ...pinned }])
    expect(() => shippedMacPackages({ packages: { 'node_modules/b-darwin-x64': { version: '1.0.0', os: ['darwin'], cpu: ['x64'] } } }))
      .toThrow('node_modules/b-darwin-x64 has no locked version, tarball and integrity')
  })
})

describe('checking a tarball against package-lock.json', () => {
  it('takes only the bytes its sha512 names', () => {
    const bytes = new TextEncoder().encode('tarball')
    expect(matchesIntegrity(bytes, integrityOf(bytes))).toBe(true)
    expect(matchesIntegrity(bytes, `sha1-x ${integrityOf(bytes)}`)).toBe(true)
    expect(matchesIntegrity(new TextEncoder().encode('other'), integrityOf(bytes))).toBe(false)
    expect(() => matchesIntegrity(bytes, 'sha1-abc')).toThrow('No sha512 integrity')
  })
})

describe('installing the packages npm ci left out', () => {
  function locked(path: string, arch: LockedMacPackage['arch'], tarball: Uint8Array, version = '2.2.2'): LockedMacPackage {
    return { path, arch, version, resolved: `https://registry.npmjs.org/${path}.tgz`, integrity: integrityOf(tarball) }
  }

  function host(tarballs: Record<string, Uint8Array>, version = '2.2.2'): InstallHost & { download: ReturnType<typeof vi.fn> } {
    return {
      download: vi.fn(async (url: string) => tarballs[url]!),
      // Stands in for tar: writes the manifest the package would unpack.
      extract: async (_tarball, directory) => { await writeFile(join(directory, 'package.json'), JSON.stringify({ version })) },
      log: () => undefined
    }
  }

  it('adds the other CPU’s binding and keeps the one npm installed', async () => {
    const x64 = new TextEncoder().encode('x64 tarball')
    const arm64 = new TextEncoder().encode('arm64 tarball')
    const packages = [locked('node_modules/@node-rs/argon2-darwin-x64', 'x64', x64), locked('node_modules/@node-rs/argon2-darwin-arm64', 'arm64', arm64)]
    await mkdir(join(root, 'node_modules/@node-rs/argon2-darwin-arm64'), { recursive: true })
    await writeFile(join(root, 'node_modules/@node-rs/argon2-darwin-arm64/package.json'), '{"version":"2.2.2"}')
    const fake = host({ [packages[0]!.resolved]: x64, [packages[1]!.resolved]: arm64 })
    expect(await installMacPackages(root, packages, fake)).toEqual(['node_modules/@node-rs/argon2-darwin-x64'])
    expect(fake.download).toHaveBeenCalledExactlyOnceWith(packages[0]!.resolved)
    expect(JSON.parse(await readFile(join(root, 'node_modules/@node-rs/argon2-darwin-x64/package.json'), 'utf8'))).toEqual({ version: '2.2.2' })
  })

  it('unpacks nothing from a tarball that is not the locked one', async () => {
    const expected = locked('node_modules/@node-rs/argon2-darwin-x64', 'x64', new TextEncoder().encode('locked'))
    const fake = host({ [expected.resolved]: new TextEncoder().encode('tampered') })
    await expect(installMacPackages(root, [expected], fake)).rejects.toThrow(/does not match package-lock\.json.s integrity/u)
    await expect(readFile(join(root, expected.path, 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a tarball that unpacks another version', async () => {
    const tarball = new TextEncoder().encode('tarball')
    const expected = locked('node_modules/@node-rs/argon2-darwin-x64', 'x64', tarball)
    await expect(installMacPackages(root, [expected], host({ [expected.resolved]: tarball }, '2.0.0')))
      .rejects.toThrow('node_modules/@node-rs/argon2-darwin-x64 unpacked as 2.0.0, not 2.2.2')
  })
})

describe('checking the packaged apps', () => {
  const packages: LockedMacPackage[] = [
    { path: 'node_modules/@node-rs/argon2-darwin-x64', arch: 'x64', version: '2.2.2', resolved: 'x', integrity: 'sha512-x' },
    { path: 'node_modules/@node-rs/argon2-darwin-arm64', arch: 'arm64', version: '2.2.2', resolved: 'y', integrity: 'sha512-y' }
  ]

  async function app(folder: string, ...bindings: string[]): Promise<void> {
    const unpacked = join(root, folder, 'Hronaut.app/Contents/Resources/app.asar.unpacked')
    await mkdir(unpacked, { recursive: true })
    for (const binding of bindings) {
      const name = binding.slice(binding.lastIndexOf('-') + 1)
      await mkdir(join(unpacked, 'node_modules/@node-rs', binding), { recursive: true })
      await writeFile(join(unpacked, 'node_modules/@node-rs', binding, `argon2.darwin-${name}.node`), '')
    }
  }

  it('finds the Intel app without its binding, as 3.8.0 shipped it', async () => {
    await app('mac', 'argon2-darwin-arm64')
    await app('mac-arm64', 'argon2-darwin-arm64')
    expect(await missingMacPackages(root, packages)).toEqual(['mac/Hronaut.app: node_modules/@node-rs/argon2-darwin-x64'])
  })

  it('passes apps that each carry the binding for their CPU', async () => {
    await app('mac', 'argon2-darwin-x64', 'argon2-darwin-arm64')
    await app('mac-arm64', 'argon2-darwin-x64', 'argon2-darwin-arm64')
    expect(await missingMacPackages(root, packages)).toEqual([])
  })

  it('counts a package folder without its addon as missing', async () => {
    await app('mac-arm64')
    await mkdir(join(root, 'mac-arm64/Hronaut.app/Contents/Resources/app.asar.unpacked/node_modules/@node-rs/argon2-darwin-arm64'), { recursive: true })
    expect(await missingMacPackages(root, packages)).toEqual(['mac-arm64/Hronaut.app: node_modules/@node-rs/argon2-darwin-arm64'])
  })

  it('fails without an app to check, or with an app folder it does not know', async () => {
    await expect(missingMacPackages(root, packages)).rejects.toThrow('No macOS app in')
    await app('mac-universal')
    await expect(missingMacPackages(root, packages)).rejects.toThrow('Unknown macOS app folder mac-universal')
  })
})

interface WorkflowStep { name?: string, if?: string, run?: string }
interface Workflow { jobs: Record<string, { steps: WorkflowStep[] }> }

async function workflow(name: string): Promise<Workflow> {
  return parse(await readFile(join('.github/workflows', name), 'utf8')) as Workflow
}

/** Where each line stands in a script, failing for a line that is not there instead of counting it as first. */
function linesIn(script: string, ...lines: string[]): number[] {
  const all = script.split('\n').map(line => line.trim())
  return lines.map((line) => {
    const at = all.indexOf(line)
    expect(at, line).toBeGreaterThanOrEqual(0)
    return at
  })
}

describe('the macOS packaging workflows', () => {
  it('install both CPUs’ packages after npm ci and before the release build, and check the apps after it', async () => {
    const step = (await workflow('release.yml')).jobs['build-macos']!.steps.find(candidate => candidate.run?.includes('electron-builder --mac'))!
    const order = linesIn(step.run!, 'npm ci', 'node scripts/mac-native-bindings.ts install', 'npm run build:app',
      'npx electron-builder --mac "$PACKAGE_TARGET" --x64 --arm64 --publish never', 'node scripts/mac-native-bindings.ts check dist')
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('do the same in the release rehearsal, on the Mac only', async () => {
    const steps = (await workflow('ci.yml')).jobs['package-release-candidate']!.steps
    const at = (run: string) => {
      const index = steps.findIndex(candidate => candidate.run === run)
      expect(index, run).toBeGreaterThanOrEqual(0)
      return index
    }
    const order = [at('npm ci'), at('node scripts/mac-native-bindings.ts install'), at('npm run ${{ matrix.command }}'), at('node scripts/mac-native-bindings.ts check dist')]
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(steps[order[1]!]!.if).toBe("runner.os == 'macOS'")
    expect(steps[order[3]!]!.if).toBe("runner.os == 'macOS'")
  })

  it('check the app each native preflight builds', async () => {
    const step = (await workflow('macos-native-preflight.yml')).jobs.native!.steps.find(candidate => candidate.run?.includes('electron-builder --mac dir'))!
    const [build, check] = linesIn(step.run!, 'npx --no-install electron-builder --mac dir "--$PACKAGE_ARCH" --publish never -c.electronFuses.enableNodeCliInspectArguments=true', 'node scripts/mac-native-bindings.ts check dist')
    expect(check).toBeGreaterThan(build!)
  })
})
