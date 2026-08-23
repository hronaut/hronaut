export const RELEASE_ASSET_MATCHERS = {
  windows: /x64-setup\.exe$/i,
  'mac-arm': /arm64\.dmg$/i,
  'mac-x64': /x64\.dmg$/i,
  'linux-x64': /x86_64\.AppImage$/i,
  'linux-arm': /arm64\.AppImage$/i
} as const

export type ReleaseAssetTarget = keyof typeof RELEASE_ASSET_MATCHERS

export function isReleaseAssetTarget(value: string | undefined): value is ReleaseAssetTarget {
  return value !== undefined && Object.hasOwn(RELEASE_ASSET_MATCHERS, value)
}

export function matchingReleaseAsset<T extends { name: string }>(assets: T[], target: ReleaseAssetTarget): T | undefined {
  return assets.find((asset) => RELEASE_ASSET_MATCHERS[target].test(asset.name))
}
