/**
 * The macOS release packages the Intel and the Apple silicon app on one Apple silicon runner from one `npm ci`, and npm
 * installs only the runner's own native packages. `install` adds, before packaging, every macOS native package the app
 * ships for either architecture, exactly as package-lock.json pins it: its locked tarball, checked against its locked
 * integrity. `check` fails, after packaging, unless each app carries every one of them for its own architecture.
 * Without them the Intel app shipped without @node-rs/argon2's binding, whose loader throws at the first import.
 *
 *   node scripts/mac-native-bindings.ts install
 *   node scripts/mac-native-bindings.ts check dist
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isMainModule } from './is-main-module.ts'

export type MacArch = 'x64' | 'arm64'
export const MAC_ARCHES: readonly MacArch[] = ['x64', 'arm64']

/** electron-builder's output folder for each architecture's app. */
const APP_FOLDERS: Readonly<Record<string, MacArch>> = { mac: 'x64', 'mac-arm64': 'arm64' }

interface LockEntry {
  name?: string
  version?: string
  resolved?: string
  integrity?: string
  dev?: boolean
  os?: string[]
  cpu?: string[]
}

export interface LockedMacPackage {
  /** Where npm installs it, such as node_modules/@node-rs/argon2-darwin-x64. */
  path: string
  arch: MacArch
  version: string
  resolved: string
  integrity: string
}

/**
 * The macOS packages built for a single CPU that package-lock.json pins outside development dependencies: the native
 * bindings the app ships, which npm installs only on a Mac with that CPU.
 */
export function shippedMacPackages(lock: { packages?: Record<string, LockEntry> }): LockedMacPackage[] {
  const shipped: LockedMacPackage[] = []
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path.startsWith('node_modules/') || entry.dev || !entry.os?.includes('darwin')) continue
    const arches = MAC_ARCHES.filter(arch => entry.cpu?.includes(arch))
    // A package for both CPUs, or for none in particular, installs on either Mac, so npm ci has it already.
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

/** Installs each locked macOS package that `npm ci` left out; returns the paths it installed. */
export async function installMacPackages(root: string, packages: readonly LockedMacPackage[], host: InstallHost): Promise<string[]> {
  const installed: string[] = []
  for (const locked of packages) {
    const directory = join(root, locked.path)
    if (existsSync(join(directory, 'package.json'))) continue
    const tarball = await host.download(locked.resolved)
    if (!matchesIntegrity(tarball, locked.integrity)) throw new Error(`${locked.path}@${locked.version} does not match package-lock.json's integrity`)
    await mkdir(directory, { recursive: true })
    await host.extract(tarball, directory)
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { version?: string }
    if (manifest.version !== locked.version) throw new Error(`${locked.path} unpacked as ${manifest.version}, not ${locked.version}`)
    host.log(`Installed ${locked.path}@${locked.version} (${locked.arch})`)
    installed.push(locked.path)
  }
  return installed
}

/** Whether a folder holds a compiled Node addon, at any depth. */
async function holdsNativeAddon(directory: string): Promise<boolean> {
  try {
    const entries = await readdir(directory, { recursive: true })
    return entries.some(name => name.endsWith('.node'))
  } catch {
    return false
  }
}

/**
 * What each packaged app in `dist` lacks: the locked macOS packages for its own architecture whose addon is not in its
 * unpacked resources. Fails when there is no app to check or an app of an architecture it does not know.
 */
export async function missingMacPackages(dist: string, packages: readonly LockedMacPackage[]): Promise<string[]> {
  const folders = (await readdir(dist, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name.startsWith('mac'))
    .map(entry => entry.name)
    .sort()
  if (!folders.length) throw new Error(`No macOS app in ${dist}`)
  const missing: string[] = []
  for (const folder of folders) {
    const arch = APP_FOLDERS[folder]
    if (!arch) throw new Error(`Unknown macOS app folder ${folder}`)
    const apps = (await readdir(join(dist, folder))).filter(name => name.endsWith('.app'))
    if (apps.length !== 1) throw new Error(`Expected one app in ${join(dist, folder)}, found ${apps.length}`)
    const unpacked = join(dist, folder, apps[0]!, 'Contents', 'Resources', 'app.asar.unpacked')
    for (const locked of packages.filter(candidate => candidate.arch === arch)) {
      if (!await holdsNativeAddon(join(unpacked, locked.path))) missing.push(`${folder}/${apps[0]}: ${locked.path}`)
    }
  }
  return missing
}

async function readLock(root: string): Promise<{ packages?: Record<string, LockEntry> }> {
  return JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')) as { packages?: Record<string, LockEntry> }
}

const realHost: InstallHost = {
  async download(url) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Downloading ${url} returned ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  },
  async extract(tarball, directory) {
    const scratch = await mkdtemp(join(tmpdir(), 'hronaut-mac-package-'))
    try {
      const file = join(scratch, 'package.tgz')
      await writeFile(file, tarball)
      execFileSync('tar', ['-xzf', file, '-C', directory, '--strip-components=1'], { stdio: 'inherit' })
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  },
  log: line => console.log(line)
}

if (isMainModule(import.meta.url)) {
  const [command, dist] = process.argv.slice(2)
  const root = process.cwd()
  const packages = shippedMacPackages(await readLock(root))
  if (command === 'install') {
    await installMacPackages(root, packages, realHost)
  } else if (command === 'check' && dist) {
    const missing = await missingMacPackages(resolve(dist), packages)
    if (missing.length) {
      for (const line of missing) console.error(`::error title=Missing macOS native package::${line}`)
      process.exit(1)
    }
    console.log(`Every macOS app in ${dist} has its native packages: ${packages.map(locked => locked.path).join(', ')}`)
  } else {
    throw new Error('Usage: node scripts/mac-native-bindings.ts install | check <dist>')
  }
}
