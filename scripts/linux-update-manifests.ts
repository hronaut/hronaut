import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[+-][0-9A-Za-z.-]+)?$/
const SAFE_ASSET_NAME = /^[0-9A-Za-z._+-]+$/

export type LinuxUpdateArchitecture = 'x64' | 'arm64'
export type LinuxUpdateKind = 'AppImage' | 'deb' | 'rpm'

export interface LinuxUpdateAsset {
  name: string
  sha512: string
  size: number
}

export interface LinuxUpdateManifest {
  version: string
  files: LinuxUpdateAsset[]
  path: string
  sha512: string
  releaseDate: string
}

function assetKind(name: string): LinuxUpdateKind | null {
  if (name.endsWith('.AppImage')) return 'AppImage'
  if (name.endsWith('.deb')) return 'deb'
  if (name.endsWith('.rpm')) return 'rpm'
  return null
}

function assetArchitecture(name: string): LinuxUpdateArchitecture | null {
  if (/(?:^|[-_.])(arm64|aarch64)(?:[-_.]|$)/i.test(name)) return 'arm64'
  if (/(?:^|[-_.])(x64|x86_64|amd64)(?:[-_.]|$)/i.test(name)) return 'x64'
  return null
}

export function buildLinuxUpdateManifest(
  version: string,
  architecture: LinuxUpdateArchitecture,
  assets: readonly LinuxUpdateAsset[],
  releaseDate = new Date().toISOString()
): LinuxUpdateManifest {
  if (!VERSION_PATTERN.test(version)) throw new Error(`Invalid release version: ${version}`)
  if (!Number.isFinite(Date.parse(releaseDate))) throw new Error(`Invalid release date: ${releaseDate}`)

  const expectedKinds: readonly LinuxUpdateKind[] = ['AppImage', 'deb', 'rpm']
  const selected = expectedKinds.map((kind) => {
    const matches = assets.filter((asset) => assetKind(asset.name) === kind && assetArchitecture(asset.name) === architecture)
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one ${architecture} ${kind} asset, found ${matches.length}`)
    }
    const asset = matches[0]
    if (!asset || !SAFE_ASSET_NAME.test(asset.name) || !asset.sha512 || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new Error(`Invalid ${architecture} ${kind} asset metadata`)
    }
    return asset
  })
  const appImage = selected[0]
  if (!appImage) throw new Error(`Missing ${architecture} AppImage asset`)
  return {
    version,
    files: selected,
    path: appImage.name,
    sha512: appImage.sha512,
    releaseDate
  }
}

export function formatLinuxUpdateManifest(manifest: LinuxUpdateManifest): string {
  const lines = [
    `version: ${manifest.version}`,
    'files:',
    ...manifest.files.flatMap((file) => [
      `  - url: ${file.name}`,
      `    sha512: ${file.sha512}`,
      `    size: ${file.size}`
    ]),
    `path: ${manifest.path}`,
    `sha512: ${manifest.sha512}`,
    `releaseDate: '${manifest.releaseDate}'`
  ]
  return `${lines.join('\n')}\n`
}

async function sha512(path: string): Promise<string> {
  const hash = createHash('sha512')
  await new Promise<void>((resolvePromise, reject) => {
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', resolvePromise)
  })
  return hash.digest('base64')
}

export async function writeLinuxUpdateManifests(directory: string, version: string, releaseDate = new Date().toISOString()): Promise<void> {
  const absoluteDirectory = resolve(directory)
  const names = (await readdir(absoluteDirectory)).filter((name) => assetKind(name) !== null)
  const assets = await Promise.all(names.map(async (name): Promise<LinuxUpdateAsset> => {
    const path = join(absoluteDirectory, name)
    const details = await stat(path)
    if (!details.isFile()) throw new Error(`Linux release asset is not a file: ${name}`)
    return { name: basename(name), sha512: await sha512(path), size: details.size }
  }))
  const releaseTimestamp = new Date(releaseDate).toISOString()
  await Promise.all((['x64', 'arm64'] as const).map(async (architecture) => {
    const manifest = buildLinuxUpdateManifest(version, architecture, assets, releaseTimestamp)
    const fileName = architecture === 'x64' ? 'latest-linux.yml' : 'latest-linux-arm64.yml'
    await writeFile(join(absoluteDirectory, fileName), formatLinuxUpdateManifest(manifest), 'utf8')
  }))
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2]
  const version = process.argv[3]
  if (!directory || !version) throw new Error('Usage: node scripts/linux-update-manifests.ts <asset-directory> <version>')
  await writeLinuxUpdateManifests(directory, version)
}
