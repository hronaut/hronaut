import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const RELEASE_ASSET_LABELS: Readonly<Record<string, string>> = {
  'x64-setup.exe': 'Windows x64 installer',
  'x64-windows-portable.exe': 'Windows x64 portable app',
  'arm64.dmg': 'macOS Apple Silicon DMG',
  'x64.dmg': 'macOS Intel DMG',
  'arm64.AppImage': 'Linux ARM64 AppImage',
  'x86_64.AppImage': 'Linux x64 AppImage',
  'arm64.deb': 'Linux ARM64 DEB package',
  'amd64.deb': 'Linux x64 DEB package',
  'aarch64.rpm': 'Linux ARM64 RPM package',
  'x86_64.rpm': 'Linux x64 RPM package'
}

function releaseAssetLabel(path: string): string | undefined {
  const name = basename(path)
  if (name === 'release-history.json') return 'Verified release history'
  if (name === 'hashes.txt') return 'SHA-256 checksums'
  if (!name.startsWith('hronaut-')) return undefined
  for (const [packageName, label] of Object.entries(RELEASE_ASSET_LABELS)) {
    const suffix = `-${packageName}`
    if (!name.endsWith(suffix)) continue
    const version = name.slice('hronaut-'.length, -suffix.length)
    if (RELEASE_VERSION_PATTERN.test(version)) return label
  }
  return undefined
}

export function releaseAssetUploadArgument(path: string): string {
  if (!path || /[\0\r\n#]/u.test(path)) throw new TypeError('Invalid release asset path')
  const label = releaseAssetLabel(path)
  return label ? `${path}#${label}` : path
}

export function releaseAssetUploadArguments(paths: readonly string[]): string[] {
  return paths.map(releaseAssetUploadArgument)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2)
  if (paths.length === 0) throw new Error('Usage: node scripts/release-asset-labels.ts <asset-path> [...]')
  for (const argument of releaseAssetUploadArguments(paths)) process.stdout.write(`${argument}\0`)
}
