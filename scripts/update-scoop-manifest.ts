import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[+-][0-9A-Za-z.-]+)?$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

interface ScoopManifest {
  version: string
  architecture: {
    '64bit': {
      url: string
      hash: string
    }
  }
  shortcuts: string[][]
  [key: string]: unknown
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

export function scoopPortableAssetName(version: string): string {
  if (!VERSION_PATTERN.test(version)) throw new Error(`Invalid release version: ${version}`)
  return `hronaut-${version}-x64-windows-portable.exe`
}

export function releaseAssetSha256(checksums: string, assetName: string): string {
  const matches: string[] = []
  for (const line of checksums.split(/\r?\n/)) {
    if (!line.trim()) continue
    const match = /^([a-f0-9]{64})[ ]{2}(.+)$/.exec(line)
    if (!match) throw new Error(`Malformed SHA-256 manifest line: ${line}`)
    const [, hash, name] = match
    if (hash && name === assetName) matches.push(hash)
  }
  const [hash] = matches
  if (matches.length !== 1 || !hash) {
    throw new Error(`Expected exactly one checksum for ${assetName}, found ${matches.length}`)
  }
  return hash
}

export function updateScoopManifestSource(
  source: string,
  version: string,
  checksums: string
): string {
  const filename = scoopPortableAssetName(version)
  const expectedUrl = `https://github.com/hronaut/hronaut/releases/download/v${version}/${filename}`
  const parsed = JSON.parse(source) as unknown
  const manifest = assertRecord(parsed, 'Scoop manifest') as unknown as ScoopManifest
  const architecture = assertRecord(manifest.architecture, 'Scoop manifest architecture')
  const portable = assertRecord(architecture['64bit'], 'Scoop manifest 64bit package')

  if (manifest.version !== version) {
    throw new Error(`Scoop manifest version ${String(manifest.version)} does not match release ${version}`)
  }
  if (portable.url !== expectedUrl) {
    throw new Error(`Scoop manifest URL does not match ${filename}`)
  }
  if (!SHA256_PATTERN.test(String(portable.hash))) {
    throw new Error('Scoop manifest contains an invalid existing SHA-256 hash')
  }
  if (
    !Array.isArray(manifest.shortcuts)
    || manifest.shortcuts.length !== 1
    || manifest.shortcuts[0]?.[0] !== filename
    || manifest.shortcuts[0]?.[1] !== 'Hronaut'
  ) {
    throw new Error(`Scoop manifest shortcut does not match ${filename}`)
  }

  const currentHash = String(portable.hash)
  const releasedHash = releaseAssetSha256(checksums, filename)
  if (releasedHash === currentHash) return source
  const hashField = `"hash": "${currentHash}"`
  if (source.split(hashField).length !== 2) {
    throw new Error('Scoop manifest hash field is not uniquely replaceable')
  }
  return source.replace(hashField, `"hash": "${releasedHash}"`)
}

export async function updateScoopManifest(
  version: string,
  checksumsPath: string,
  manifestPath = 'packaging/scoop/hronaut.json'
): Promise<boolean> {
  const absoluteManifestPath = resolve(manifestPath)
  const [source, checksums] = await Promise.all([
    readFile(absoluteManifestPath, 'utf8'),
    readFile(resolve(checksumsPath), 'utf8')
  ])
  const next = updateScoopManifestSource(source, version, checksums)
  if (next === source) return false
  await writeFile(absoluteManifestPath, next, 'utf8')
  return true
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  const version = process.argv[2]
  const checksumsPath = process.argv[3]
  if (!version || !checksumsPath) {
    throw new Error('Usage: node scripts/update-scoop-manifest.ts <version> <hashes-path> [manifest-path]')
  }
  const changed = await updateScoopManifest(version, checksumsPath, process.argv[4])
  console.log(changed ? `Updated Scoop manifest for v${version}.` : `Scoop manifest already matches v${version}.`)
}
