import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_SITE_URL = 'https://hronaut.dev'
const DEFAULT_ATTEMPTS = 24
const DEFAULT_RETRY_DELAY_MS = 10_000

export const PUBLIC_RELEASE_ASSET_KEYS = [
  'hashes',
  'windows-installer',
  'windows-portable',
  'macos-arm64',
  'macos-x64',
  'linux-arm64-appimage',
  'linux-x64-appimage',
  'linux-arm64-deb',
  'linux-x64-deb',
  'linux-arm64-rpm',
  'linux-x64-rpm'
] as const

type PublicReleaseAssetKey = typeof PUBLIC_RELEASE_ASSET_KEYS[number]

export interface PublicReleaseAsset {
  name: string
  url: string
  size: number
}

export interface PublicReleaseManifest {
  version: string
  tag: string
  url: string
  publishedAt: string
  summary: string
  assets: Record<PublicReleaseAssetKey, PublicReleaseAsset>
}

export interface PublicReleaseVerificationOptions {
  version: string
  siteUrl?: string
  fetcher?: typeof fetch
}

export interface PublicReleaseWaitOptions extends PublicReleaseVerificationOptions {
  attempts?: number
  retryDelayMs?: number
  sleep?: (delayMs: number) => Promise<void>
  onAttemptFailure?: (attempt: number, error: unknown) => void
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid release version: ${version}`)
}

function publicReleaseAssetNames(version: string): Record<PublicReleaseAssetKey, string> {
  return {
    hashes: 'hashes.txt',
    'windows-installer': `hronaut-${version}-x64-setup.exe`,
    'windows-portable': `hronaut-${version}-x64-windows-portable.exe`,
    'macos-arm64': `hronaut-${version}-arm64.dmg`,
    'macos-x64': `hronaut-${version}-x64.dmg`,
    'linux-arm64-appimage': `hronaut-${version}-arm64.AppImage`,
    'linux-x64-appimage': `hronaut-${version}-x86_64.AppImage`,
    'linux-arm64-deb': `hronaut-${version}-arm64.deb`,
    'linux-x64-deb': `hronaut-${version}-amd64.deb`,
    'linux-arm64-rpm': `hronaut-${version}-aarch64.rpm`,
    'linux-x64-rpm': `hronaut-${version}-x86_64.rpm`
  }
}

function publicReleaseUrl(version: string): string {
  return `https://github.com/hronaut/hronaut/releases/tag/v${version}`
}

function publicAssetUrl(version: string, name: string): string {
  return `https://github.com/hronaut/hronaut/releases/download/v${version}/${name}`
}

export function parsePublicReleaseManifest(value: unknown, expectedVersion: string): PublicReleaseManifest {
  assertVersion(expectedVersion)
  const manifest = assertRecord(value, 'Public release manifest')
  const expectedTag = `v${expectedVersion}`
  const expectedReleaseUrl = publicReleaseUrl(expectedVersion)
  if (manifest.version !== expectedVersion || manifest.tag !== expectedTag || manifest.url !== expectedReleaseUrl) {
    throw new Error(`hronaut.dev resolves ${String(manifest.tag ?? 'an unknown release')}, expected ${expectedTag}`)
  }
  if (
    typeof manifest.publishedAt !== 'string'
    || !Number.isFinite(Date.parse(manifest.publishedAt))
    || typeof manifest.summary !== 'string'
    || !manifest.summary.trim()
    || manifest.summary.length > 200
  ) {
    throw new Error(`hronaut.dev returned incomplete metadata for ${expectedTag}`)
  }

  const assets = assertRecord(manifest.assets, 'Public release assets')
  const expectedNames = publicReleaseAssetNames(expectedVersion)
  if (
    Object.keys(assets).length !== PUBLIC_RELEASE_ASSET_KEYS.length
    || PUBLIC_RELEASE_ASSET_KEYS.some((key) => !(key in assets))
  ) {
    throw new Error(`hronaut.dev returned an incomplete asset map for ${expectedTag}`)
  }
  const parsedAssets = {} as Record<PublicReleaseAssetKey, PublicReleaseAsset>
  for (const key of PUBLIC_RELEASE_ASSET_KEYS) {
    const asset = assertRecord(assets[key], `Public release asset ${key}`)
    const expectedName = expectedNames[key]
    const expectedUrl = publicAssetUrl(expectedVersion, expectedName)
    if (
      asset.name !== expectedName
      || asset.url !== expectedUrl
      || !Number.isSafeInteger(asset.size)
      || Number(asset.size) <= 0
    ) {
      throw new Error(`hronaut.dev returned invalid ${key} metadata for ${expectedTag}`)
    }
    parsedAssets[key] = {
      name: expectedName,
      url: expectedUrl,
      size: Number(asset.size)
    }
  }

  return {
    version: expectedVersion,
    tag: expectedTag,
    url: expectedReleaseUrl,
    publishedAt: manifest.publishedAt,
    summary: manifest.summary,
    assets: parsedAssets
  }
}

async function expectRedirect(
  fetcher: typeof fetch,
  source: URL,
  destination: string
): Promise<void> {
  const response = await fetcher(source, { method: 'HEAD', redirect: 'manual' })
  if (response.status !== 302 || response.headers.get('location') !== destination) {
    throw new Error(`${source.pathname} does not redirect to the published release`)
  }
}

export async function verifyPublicRelease(
  options: PublicReleaseVerificationOptions
): Promise<PublicReleaseManifest> {
  assertVersion(options.version)
  const fetcher = options.fetcher ?? fetch
  const siteUrl = new URL(options.siteUrl ?? DEFAULT_SITE_URL)
  if (siteUrl.protocol !== 'https:') throw new Error('Public release verification requires HTTPS')

  const response = await fetcher(new URL('/api/release', siteUrl), {
    cache: 'no-store',
    headers: { accept: 'application/json' }
  })
  if (!response.ok) throw new Error(`hronaut.dev release manifest failed with ${response.status}`)
  const manifest = parsePublicReleaseManifest(await response.json(), options.version)

  await expectRedirect(fetcher, new URL('/releases/latest', siteUrl), manifest.url)
  await Promise.all(PUBLIC_RELEASE_ASSET_KEYS.map((key) => (
    expectRedirect(fetcher, new URL(`/releases/${key}`, siteUrl), manifest.assets[key].url)
  )))
  return manifest
}

export async function waitForPublicRelease(
  options: PublicReleaseWaitOptions
): Promise<PublicReleaseManifest> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  if (!Number.isSafeInteger(attempts) || attempts < 1) throw new Error('Release verification attempts must be positive')
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) throw new Error('Release retry delay must be non-negative')
  const sleep = options.sleep ?? ((delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)))
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await verifyPublicRelease(options)
    } catch (error) {
      lastError = error
      options.onAttemptFailure?.(attempt, error)
      if (attempt < attempts) await sleep(retryDelayMs)
    }
  }
  throw new Error(`hronaut.dev did not resolve v${options.version} after ${attempts} attempts`, {
    cause: lastError
  })
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  const version = process.argv[2]
  if (!version) throw new Error('Usage: node scripts/verify-public-release.ts <version>')
  const release = await waitForPublicRelease({
    version,
    onAttemptFailure: (attempt, error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`Public release verification attempt ${attempt} failed: ${message}`)
    }
  })
  console.log(`Verified hronaut.dev release ${release.tag} and ${PUBLIC_RELEASE_ASSET_KEYS.length} downloads.`)
}
