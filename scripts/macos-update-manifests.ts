import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMap, parseDocument } from 'yaml'

// electron-updater compares os.release() (Darwin), not the macOS product version.
export const MINIMUM_MACOS_DARWIN_VERSION = '22.0.0'

export function protectMacUpdateManifest(source: string, version: string): string {
  if (!/^\d+\.\d+\.\d+(?:[+-][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Invalid release version')
  }
  const document = parseDocument(source)
  if (document.errors.length || document.warnings.length || !isMap(document.contents)) throw new Error('Malformed macOS update manifest')
  const manifest = document.toJS() as Record<string, unknown>
  if (manifest.version !== version) throw new Error('macOS update manifest version mismatch')
  if (!Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.some((file: unknown) => {
    if (typeof file !== 'object' || file === null) return true
    const asset = file as Record<string, unknown>
    return typeof asset.url !== 'string' || !asset.url || typeof asset.sha512 !== 'string' || !asset.sha512 ||
      typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0
  })) throw new Error('Malformed macOS update manifest files')
  const minimum = manifest.minimumSystemVersion
  if (minimum !== undefined && (typeof minimum !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(minimum) ||
    minimum.split('.').some(part => !Number.isSafeInteger(Number(part))))) {
    throw new Error('Malformed macOS minimumSystemVersion')
  }
  // Preserve a stricter pre-existing requirement; never downgrade an upstream floor.
  if (typeof minimum !== 'string' || Number(minimum.split('.')[0]) < 22) {
    document.set('minimumSystemVersion', MINIMUM_MACOS_DARWIN_VERSION)
  }
  return document.toString()
}

export async function protectMacUpdateManifests(directory: string, version: string): Promise<void> {
  const names = (await readdir(directory)).filter(name => /^latest-mac.*\.yml$/.test(name)).sort()
  if (!names.length) throw new Error('No macOS update manifests found')
  // Validate the entire set before touching any downloaded artifact.
  const updates = await Promise.all(names.map(async name => {
    const path = resolve(directory, name)
    return { path, content: protectMacUpdateManifest(await readFile(path, 'utf8'), version) }
  }))
  for (const update of updates) await writeFile(update.path, update.content)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2]
  const version = process.argv[3]
  if (!directory || !version) throw new Error('Usage: node scripts/macos-update-manifests.ts <directory> <version>')
  await protectMacUpdateManifests(directory, version)
}
