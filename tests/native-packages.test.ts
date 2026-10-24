import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import {
  addonArch,
  extractTarball,
  installNativePackages,
  matchesIntegrity,
  missingNativePackages,
  shippedNativePackages,
  type InstallHost,
  type LockedNativePackage,
  type PackageArch
} from '../scripts/native-packages.ts'

const integrityOf = (bytes: Uint8Array): string => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

/** The first bytes of a compiled addon: a 64-bit Mach-O file on macOS, a little-endian ELF file on Linux. */
function addonHeader(format: 'mach-o' | 'elf', arch: PackageArch): Uint8Array {
  const header = new Uint8Array(64)
  const view = new DataView(header.buffer)
  if (format === 'mach-o') {
    view.setUint32(0, 0xfeedfacf, true)
    view.setUint32(4, arch === 'x64' ? 0x01000007 : 0x0100000c, true)
  } else {
    header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1])
    view.setUint16(18, arch === 'x64' ? 62 : 183, true)
  }
  return header
}

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'hronaut-native-packages-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('the native packages the app ships', () => {
  it('are argon2 for both CPUs of each system in this package-lock.json, pinned with their tarball and integrity', async () => {
    const lock = JSON.parse(await readFile('package-lock.json', 'utf8')) as Parameters<typeof shippedNativePackages>[0]
    const paths = (system: 'mac' | 'linux') => shippedNativePackages(lock, system).map(({ path, arch }) => [path, arch])
    expect(paths('mac')).toEqual(expect.arrayContaining([
      ['node_modules/@node-rs/argon2-darwin-x64', 'x64'],
      ['node_modules/@node-rs/argon2-darwin-arm64', 'arm64']
    ]))
    // The Linux packages run on glibc, so the musl builds stay out.
    expect(paths('linux')).toEqual(expect.arrayContaining([
      ['node_modules/@node-rs/argon2-linux-x64-gnu', 'x64'],
      ['node_modules/@node-rs/argon2-linux-arm64-gnu', 'arm64']
    ]))
    expect(paths('linux').flat()).not.toContain('node_modules/@node-rs/argon2-linux-arm64-musl')
    for (const locked of [...shippedNativePackages(lock, 'mac'), ...shippedNativePackages(lock, 'linux')]) {
      expect(locked.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//u)
      expect(locked.integrity).toMatch(/^sha512-/u)
    }
  })

  it('leave out development tools, packages for both CPUs, other systems and C libraries, and refuse an unpinned one', () => {
    const pinned = { version: '1.0.0', resolved: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz', integrity: 'sha512-AA==' }
    const lock = {
      packages: {
        '': {},
        'node_modules/@esbuild/darwin-x64': { ...pinned, dev: true, os: ['darwin'], cpu: ['x64'] },
        'node_modules/universal-darwin': { ...pinned, os: ['darwin'], cpu: ['x64', 'arm64'] },
        'node_modules/any-cpu-darwin': { ...pinned, os: ['darwin'] },
        'node_modules/binding-win32-x64': { ...pinned, os: ['win32'], cpu: ['x64'] },
        'node_modules/binding-darwin-arm64': { ...pinned, os: ['darwin'], cpu: ['arm64'] },
        'node_modules/binding-linux-arm64-musl': { ...pinned, os: ['linux'], cpu: ['arm64'], libc: ['musl'] },
        'node_modules/binding-linux-arm64-gnu': { ...pinned, os: ['linux'], cpu: ['arm64'], libc: ['glibc'] },
        'node_modules/outer/node_modules/binding-linux-x64': { ...pinned, os: ['linux'], cpu: ['x64'] }
      }
    }
    expect(shippedNativePackages(lock, 'mac')).toEqual([{ path: 'node_modules/binding-darwin-arm64', arch: 'arm64', ...pinned }])
    expect(shippedNativePackages(lock, 'linux')).toEqual([
      { path: 'node_modules/binding-linux-arm64-gnu', arch: 'arm64', ...pinned },
      { path: 'node_modules/outer/node_modules/binding-linux-x64', arch: 'x64', ...pinned }
    ])
    expect(() => shippedNativePackages({ packages: { 'node_modules/b-darwin-x64': { version: '1.0.0', os: ['darwin'], cpu: ['x64'] } } }, 'mac'))
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
  function locked(path: string, arch: PackageArch, tarball: Uint8Array, version = '2.2.2'): LockedNativePackage {
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

  /** What is left in the package's folder: nothing, after a failed install, so a later run installs it again. */
  const leftIn = async (folder: string) => (await readdir(join(root, folder)).catch(() => [])).sort()

  it('adds the other CPU\'s binding and keeps the one npm installed', async () => {
    const x64 = new TextEncoder().encode('x64 tarball')
    const arm64 = new TextEncoder().encode('arm64 tarball')
    const packages = [locked('node_modules/@node-rs/argon2-darwin-x64', 'x64', x64), locked('node_modules/@node-rs/argon2-darwin-arm64', 'arm64', arm64)]
    await mkdir(join(root, 'node_modules/@node-rs/argon2-darwin-arm64'), { recursive: true })
    await writeFile(join(root, 'node_modules/@node-rs/argon2-darwin-arm64/package.json'), '{"version":"2.2.2"}')
    const fake = host({ [packages[0]!.resolved]: x64, [packages[1]!.resolved]: arm64 })
    expect(await installNativePackages(root, packages, fake)).toEqual(['node_modules/@node-rs/argon2-darwin-x64'])
    expect(fake.download).toHaveBeenCalledExactlyOnceWith(packages[0]!.resolved)
    expect(JSON.parse(await readFile(join(root, 'node_modules/@node-rs/argon2-darwin-x64/package.json'), 'utf8'))).toEqual({ version: '2.2.2' })
    expect(await leftIn('node_modules/@node-rs')).toEqual(['argon2-darwin-arm64', 'argon2-darwin-x64'])
  })

  it('unpacks nothing from a tarball that is not the locked one', async () => {
    const expected = locked('node_modules/@node-rs/argon2-darwin-x64', 'x64', new TextEncoder().encode('locked'))
    const fake = host({ [expected.resolved]: new TextEncoder().encode('tampered') })
    await expect(installNativePackages(root, [expected], fake)).rejects.toThrow(/does not match package-lock\.json.s integrity/u)
    expect(await leftIn('node_modules/@node-rs')).toEqual([])
  })

  it('leaves nothing behind for a tarball that unpacks another version, so the next run installs it again', async () => {
    const tarball = new TextEncoder().encode('tarball')
    const expected = locked('node_modules/@node-rs/argon2-linux-arm64-gnu', 'arm64', tarball)
    await expect(installNativePackages(root, [expected], host({ [expected.resolved]: tarball }, '2.0.0')))
      .rejects.toThrow('node_modules/@node-rs/argon2-linux-arm64-gnu unpacked as 2.0.0, not 2.2.2')
    expect(await leftIn('node_modules/@node-rs')).toEqual([])
    expect(await installNativePackages(root, [expected], host({ [expected.resolved]: tarball }))).toEqual([expected.path])
  })

  it('unpacks an npm tarball with the system\'s tar, without its package folder', async () => {
    const source = join(root, 'source')
    await mkdir(join(source, 'package'), { recursive: true })
    await writeFile(join(source, 'package/package.json'), '{"version":"2.2.2"}')
    await writeFile(join(source, 'package/argon2.linux-arm64-gnu.node'), addonHeader('elf', 'arm64'))
    execFileSync('tar', ['-czf', join(root, 'package.tgz'), '-C', source, 'package'])
    const target = join(root, 'target')
    await mkdir(target)
    await extractTarball(await readFile(join(root, 'package.tgz')), target)
    expect((await readdir(target)).sort()).toEqual(['argon2.linux-arm64-gnu.node', 'package.json'])
  })
})

describe('telling which CPU an addon is built for', () => {
  it('reads Mach-O and ELF headers, and knows nothing else', () => {
    expect(addonArch(addonHeader('mach-o', 'x64'))).toBe('x64')
    expect(addonArch(addonHeader('mach-o', 'arm64'))).toBe('arm64')
    expect(addonArch(addonHeader('elf', 'x64'))).toBe('x64')
    expect(addonArch(addonHeader('elf', 'arm64'))).toBe('arm64')
    expect(addonArch(new TextEncoder().encode('MZ not an addon for these systems'))).toBeNull()
    expect(addonArch(new Uint8Array(3))).toBeNull()
  })
})

describe('checking the packaged apps', () => {
  const mac: LockedNativePackage[] = [
    { path: 'node_modules/@node-rs/argon2-darwin-x64', arch: 'x64', version: '2.2.2', resolved: 'x', integrity: 'sha512-x' },
    { path: 'node_modules/@node-rs/argon2-darwin-arm64', arch: 'arm64', version: '2.2.2', resolved: 'y', integrity: 'sha512-y' }
  ]
  const linux: LockedNativePackage[] = [
    { path: 'node_modules/@node-rs/argon2-linux-x64-gnu', arch: 'x64', version: '2.2.2', resolved: 'x', integrity: 'sha512-x' },
    { path: 'node_modules/@node-rs/argon2-linux-arm64-gnu', arch: 'arm64', version: '2.2.2', resolved: 'y', integrity: 'sha512-y' }
  ]

  /** An app electron-builder wrote, with each binding built for the CPU its package names unless told otherwise. */
  async function app(folder: string, bindings: Record<string, PackageArch | null>): Promise<void> {
    const unpacked = folder.startsWith('mac')
      ? join(root, folder, 'Hronaut.app/Contents/Resources/app.asar.unpacked')
      : join(root, folder, 'resources/app.asar.unpacked')
    await mkdir(unpacked, { recursive: true })
    for (const [binding, arch] of Object.entries(bindings)) {
      await mkdir(join(unpacked, 'node_modules/@node-rs', binding), { recursive: true })
      if (arch) await writeFile(join(unpacked, 'node_modules/@node-rs', binding, `${binding}.node`), addonHeader(folder.startsWith('mac') ? 'mach-o' : 'elf', arch))
    }
  }

  it('finds the Intel Mac app without its binding, as 3.8.0 shipped it', async () => {
    await app('mac', { 'argon2-darwin-arm64': 'arm64' })
    await app('mac-arm64', { 'argon2-darwin-arm64': 'arm64' })
    expect(await missingNativePackages(root, 'mac', mac)).toEqual(['mac: node_modules/@node-rs/argon2-darwin-x64 (x64)'])
  })

  it('finds the arm64 Linux app without its binding, as 3.8.0 shipped it', async () => {
    await app('linux-unpacked', { 'argon2-linux-x64-gnu': 'x64' })
    await app('linux-arm64-unpacked', { 'argon2-linux-x64-gnu': 'x64' })
    expect(await missingNativePackages(root, 'linux', linux)).toEqual(['linux-arm64-unpacked: node_modules/@node-rs/argon2-linux-arm64-gnu (arm64)'])
  })

  it('passes apps that each carry the binding for their CPU', async () => {
    await app('mac', { 'argon2-darwin-x64': 'x64', 'argon2-darwin-arm64': 'arm64' })
    await app('mac-arm64', { 'argon2-darwin-x64': 'x64', 'argon2-darwin-arm64': 'arm64' })
    expect(await missingNativePackages(root, 'mac', mac)).toEqual([])
    await app('linux-unpacked', { 'argon2-linux-x64-gnu': 'x64', 'argon2-linux-arm64-gnu': 'arm64' })
    await app('linux-arm64-unpacked', { 'argon2-linux-x64-gnu': 'x64', 'argon2-linux-arm64-gnu': 'arm64' })
    expect(await missingNativePackages(root, 'linux', linux)).toEqual([])
  })

  it('counts a package folder without its addon, or with an addon built for the other CPU, as missing', async () => {
    await app('mac-arm64', { 'argon2-darwin-arm64': null })
    expect(await missingNativePackages(root, 'mac', mac)).toEqual(['mac-arm64: node_modules/@node-rs/argon2-darwin-arm64 (arm64)'])
    await app('linux-arm64-unpacked', { 'argon2-linux-arm64-gnu': 'x64' })
    expect(await missingNativePackages(root, 'linux', linux)).toEqual(['linux-arm64-unpacked: node_modules/@node-rs/argon2-linux-arm64-gnu (arm64)'])
  })

  it('fails without an app to check, or with an app folder it does not know', async () => {
    await expect(missingNativePackages(root, 'mac', mac)).rejects.toThrow('No mac app in')
    await app('mac-universal', {})
    await expect(missingNativePackages(root, 'mac', mac)).rejects.toThrow('Unknown mac app folder mac-universal')
    await app('linux-armv7l-unpacked', {})
    await expect(missingNativePackages(root, 'linux', linux)).rejects.toThrow('Unknown linux app folder linux-armv7l-unpacked')
  })
})

interface WorkflowStep { name?: string, if?: string, run?: string }
interface Workflow { jobs: Record<string, { steps: WorkflowStep[], strategy?: { matrix?: { include?: Array<Record<string, string>> } } }> }

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

describe('the packaging workflows', () => {
  it.each([
    ['release.yml', 'build-macos', 'mac', 'npx electron-builder --mac "$PACKAGE_TARGET" --x64 --arm64 --publish never -c.mac.forceCodeSigning=true'],
    ['release.yml', 'build-linux', 'linux', 'npx electron-builder --linux "$PACKAGE_TARGET" --x64 --arm64 --publish never'],
    ['ci.yml', 'package-macos-release-candidate', 'mac', 'npx electron-builder --mac --publish never -c.mac.forceCodeSigning=true']
  ])('install both CPUs\' packages after npm ci and before the %s %s build, and check the apps after it', async (file, job, system, build) => {
    // The job's scripts in the order its steps run them.
    const script = (await workflow(file)).jobs[job]!.steps.map(step => step.run ?? '').join('\n')
    const order = linesIn(script, 'npm ci', `node scripts/native-packages.ts install ${system}`, 'npm run build:app', build, `node scripts/native-packages.ts check ${system} dist`)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // A Mac app without its packages stops before it is sent to Apple to notarize.
    if (system === 'mac') expect(linesIn(script, 'bash scripts/notarize-and-verify-macos.sh')[0]).toBeGreaterThan(order.at(-1)!)
  })

  it('do the same in the release rehearsal\'s Linux packages', async () => {
    const job = (await workflow('ci.yml')).jobs['package-release-candidate']!
    expect(job.strategy?.matrix?.include?.map(entry => [entry.command, entry.native])).toEqual([
      ['package:linux', 'linux'],
      ['package:win', undefined]
    ])
    const at = (run: string) => {
      const index = job.steps.findIndex(candidate => candidate.run === run)
      expect(index, run).toBeGreaterThanOrEqual(0)
      return index
    }
    const order = [
      at('npm ci'),
      at('node scripts/native-packages.ts install ${{ matrix.native }}'),
      at('npm run ${{ matrix.command }}'),
      at('node scripts/native-packages.ts check ${{ matrix.native }} dist')
    ]
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(job.steps[order[1]!]!.if).toBe('matrix.native')
    expect(job.steps[order[3]!]!.if).toBe('matrix.native')
  })

  it('check the app each native preflight builds', async () => {
    const step = (await workflow('macos-native-preflight.yml')).jobs.native!.steps.find(candidate => candidate.run?.includes('electron-builder --mac dir'))!
    const [build, check] = linesIn(step.run!, 'npx --no-install electron-builder --mac dir "--$PACKAGE_ARCH" --publish never -c.electronFuses.enableNodeCliInspectArguments=true', 'node scripts/native-packages.ts check mac dist')
    expect(check).toBeGreaterThan(build!)
  })
})
