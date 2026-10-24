/**
 * The macOS and the Linux release each package the x64 and the arm64 app on one runner from one `npm ci`, and npm
 * installs only the runner's own native packages. `install` adds, before packaging, every native package the app ships
 * for either CPU of that system, exactly as package-lock.json pins it: its locked tarball, checked against its locked
 * integrity. `check` fails, after packaging, unless each app carries every one of them, built for its own CPU. Without
 * them the Intel Mac app and the arm64 Linux app shipped without @node-rs/argon2's binding, whose loader throws at the
 * first import, so they stopped at launch.
 *
 *   node scripts/native-packages.ts install mac|linux
 *   node scripts/native-packages.ts check mac|linux dist
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { isMainModule } from './is-main-module.ts'

export type PackageArch = 'x64' | 'arm64'
export const PACKAGE_ARCHES: readonly PackageArch[] = ['x64', 'arm64']
export type PackagedSystem = 'mac' | 'linux'

interface SystemLayout {
  /** npm's name for the system, as a package's `os` lists it. */
  os: string
  /** The C library the app runs on, as a package's `libc` lists it; none on macOS. */
  libc?: string
  /** electron-builder's output folder for each CPU's app. */
  appFolders: Readonly<Record<string, PackageArch>>
  /** Where an app folder keeps the files unpacked from app.asar. */
  unpacked(appFolder: string): Promise<string>
}

/** A folder's only entry with this ending, such as the one app electron-builder writes for a CPU. */
async function onlyEntry(folder: string, ending: string): Promise<string> {
  const entries = (await readdir(folder)).filter(name => name.endsWith(ending))
  if (entries.length !== 1) throw new Error(`Expected one ${ending} in ${folder}, found ${entries.length}`)
  return join(folder, entries[0]!)
}

const SYSTEMS: Readonly<Record<PackagedSystem, SystemLayout>> = {
  mac: {
    os: 'darwin',
    appFolders: { mac: 'x64', 'mac-arm64': 'arm64' },
    unpacked: async folder => join(await onlyEntry(folder, '.app'), 'Contents', 'Resources', 'app.asar.unpacked')
  },
  linux: {
    os: 'linux',
    // The AppImage, deb and rpm packages run on glibc systems.
    libc: 'glibc',
    appFolders: { 'linux-unpacked': 'x64', 'linux-arm64-unpacked': 'arm64' },
    unpacked: async folder => join(folder, 'resources', 'app.asar.unpacked')
  }
}

interface LockEntry {
  version?: string
  resolved?: string
  integrity?: string
  dev?: boolean
  os?: string[]
  cpu?: string[]
  libc?: string[]
}

export interface LockedNativePackage {
  /** Where npm installs it, such as node_modules/@node-rs/argon2-darwin-x64. */
  path: string
  arch: PackageArch
  version: string
  resolved: string
  integrity: string
}

/**
 * The packages built for one CPU of a system that package-lock.json pins outside development dependencies: the native
 * bindings the app ships there, which npm installs only on a computer with that CPU.
 */
export function shippedNativePackages(lock: { packages?: Record<string, LockEntry> }, system: PackagedSystem): LockedNativePackage[] {
  const { os, libc } = SYSTEMS[system]
  const shipped: LockedNativePackage[] = []
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path.startsWith('node_modules/') || entry.dev || !entry.os?.includes(os)) continue
    if (libc && entry.libc && !entry.libc.includes(libc)) continue
    const arches = PACKAGE_ARCHES.filter(arch => entry.cpu?.includes(arch))
    // A package for both CPUs, or for none in particular, installs on either, so npm ci has it already.
    if (arches.length !== 1) continue
    const { version, resolved, integrity } = entry
    if (!version || !resolved || !integrity) throw new Error(`${path} has no locked version, tarball and integrity`)
    shipped.push({ path, arch: arches[0]!, version, resolved, integrity })
  }
  return shipped
}

/** Whether these bytes are the ones package-lock.json's integrity names, in any of the hashes it lists. */
export function matchesIntegrity(bytes: Uint8Array, integrity: string): boolean {
  const hashes = integrity.trim().split(/\s+/u).map((part) => {
    const at = part.indexOf('-')
    return { algorithm: part.slice(0, at), digest: part.slice(at + 1) }
  }).filter(({ algorithm }) => algorithm === 'sha512')
  if (!hashes.length) throw new Error(`No sha512 integrity in ${integrity}`)
  const actual = createHash('sha512').update(bytes).digest('base64')
  return hashes.some(({ digest }) => digest === actual)
}

export interface InstallHost {
  download(url: string): Promise<Uint8Array>
  /** Unpacks an npm tarball into `directory`, dropping its top-level `package/` folder. */
  extract(tarball: Uint8Array, directory: string): Promise<void>
  log(line: string): void
}

/**
 * Installs each locked package that `npm ci` left out; returns the paths it installed. Each one is unpacked and checked
 * beside its place first and moved in only then, so a failed install leaves nothing a later run would take as done.
 */
export async function installNativePackages(root: string, packages: readonly LockedNativePackage[], host: InstallHost): Promise<string[]> {
  const installed: string[] = []
  for (const locked of packages) {
    const directory = join(root, locked.path)
    if (existsSync(join(directory, 'package.json'))) continue
    const tarball = await host.download(locked.resolved)
    if (!matchesIntegrity(tarball, locked.integrity)) throw new Error(`${locked.path}@${locked.version} does not match package-lock.json's integrity`)
    await mkdir(dirname(directory), { recursive: true })
    const unpacking = await mkdtemp(`${directory}.unpacking-`)
    try {
      await host.extract(tarball, unpacking)
      const manifest = JSON.parse(await readFile(join(unpacking, 'package.json'), 'utf8')) as { version?: string }
      if (manifest.version !== locked.version) throw new Error(`${locked.path} unpacked as ${manifest.version}, not ${locked.version}`)
      await rm(directory, { recursive: true, force: true })
      await rename(unpacking, directory)
    } finally {
      await rm(unpacking, { recursive: true, force: true })
    }
    host.log(`Installed ${locked.path}@${locked.version} (${locked.arch})`)
    installed.push(locked.path)
  }
  return installed
}

/** The CPU a compiled Node addon runs on, from its Mach-O or ELF header; null for anything else. */
export function addonArch(header: Uint8Array): PackageArch | null {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  if (header.byteLength >= 8 && view.getUint32(0, true) === 0xfeedfacf) {
    const cpuType = view.getUint32(4, true)
    return cpuType === 0x01000007 ? 'x64' : cpuType === 0x0100000c ? 'arm64' : null
  }
  if (header.byteLength >= 20 && view.getUint32(0, false) === 0x7f454c46) {
    const machine = view.getUint16(18, header[5] === 1)
    return machine === 62 ? 'x64' : machine === 183 ? 'arm64' : null
  }
  return null
}

/** Whether a folder holds a compiled Node addon for this CPU, at any depth. */
async function holdsAddonFor(directory: string, arch: PackageArch): Promise<boolean> {
  let entries: string[]
  try {
    entries = await readdir(directory, { recursive: true })
  } catch {
    return false
  }
  for (const name of entries.filter(entry => entry.endsWith('.node'))) {
    if (addonArch(await readFile(join(directory, name))) === arch) return true
  }
  return false
}

/**
 * What each packaged app of a system in `dist` lacks: the locked packages for its own CPU without an addon built for
 * that CPU in its unpacked resources. Fails when there is no app to check or an app of a CPU it does not know.
 */
export async function missingNativePackages(dist: string, system: PackagedSystem, packages: readonly LockedNativePackage[]): Promise<string[]> {
  const { appFolders, unpacked } = SYSTEMS[system]
  const folders = (await readdir(dist, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name.startsWith(system === 'mac' ? 'mac' : 'linux-'))
    .map(entry => entry.name)
    .sort()
  if (!folders.length) throw new Error(`No ${system} app in ${dist}`)
  const missing: string[] = []
  for (const folder of folders) {
    const arch = appFolders[folder]
    if (!arch) throw new Error(`Unknown ${system} app folder ${folder}`)
    const resources = await unpacked(join(dist, folder))
    for (const locked of packages.filter(candidate => candidate.arch === arch)) {
      if (!await holdsAddonFor(join(resources, locked.path), arch)) missing.push(`${folder}: ${locked.path} (${arch})`)
    }
  }
  return missing
}

/** Unpacks an npm tarball into `directory` with the system's tar, dropping its top-level `package/` folder. */
export async function extractTarball(tarball: Uint8Array, directory: string): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'hronaut-native-package-'))
  try {
    const file = join(scratch, 'package.tgz')
    await writeFile(file, tarball)
    execFileSync('tar', ['-xzf', file, '-C', directory, '--strip-components=1'], { stdio: 'inherit' })
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

const realHost: InstallHost = {
  async download(url) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Downloading ${url} returned ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  },
  extract: extractTarball,
  log: line => console.log(line)
}

const USAGE = 'Usage: node scripts/native-packages.ts install mac|linux | check mac|linux <dist>'

if (isMainModule(import.meta.url)) {
  const [command, system, dist] = process.argv.slice(2)
  if (system !== 'mac' && system !== 'linux') throw new Error(USAGE)
  const root = process.cwd()
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')) as { packages?: Record<string, LockEntry> }
  const packages = shippedNativePackages(lock, system)
  if (command === 'install') {
    await installNativePackages(root, packages, realHost)
  } else if (command === 'check' && dist) {
    const missing = await missingNativePackages(resolve(dist), system, packages)
    if (missing.length) {
      for (const line of missing) console.error(`::error title=Missing native package::${line}`)
      process.exit(1)
    }
    console.log(`Every ${system} app in ${dist} has its native packages: ${packages.map(locked => locked.path).join(', ')}`)
  } else {
    throw new Error(USAGE)
  }
}
