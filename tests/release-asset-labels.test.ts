import { describe, expect, it } from 'vitest'
import { releaseAssetUploadArgument, releaseAssetUploadArguments } from '../scripts/release-asset-labels.js'

describe('release asset labels', () => {
  it.each([
    ['release-history.json', 'Verified release history'],
    ['hashes.txt', 'SHA-256 checksums'],
    ['hronaut-1.11.35-x64-setup.exe', 'Windows x64 installer'],
    ['hronaut-1.11.35-x64-windows-portable.exe', 'Windows x64 portable app'],
    ['hronaut-1.11.35-arm64.dmg', 'macOS Apple Silicon DMG'],
    ['hronaut-1.11.35-x64.dmg', 'macOS Intel DMG'],
    ['hronaut-1.11.35-arm64.AppImage', 'Linux ARM64 AppImage'],
    ['hronaut-1.11.35-x86_64.AppImage', 'Linux x64 AppImage'],
    ['hronaut-1.11.35-arm64.deb', 'Linux ARM64 DEB package'],
    ['hronaut-1.11.35-amd64.deb', 'Linux x64 DEB package'],
    ['hronaut-1.11.35-aarch64.rpm', 'Linux ARM64 RPM package'],
    ['hronaut-1.11.35-x86_64.rpm', 'Linux x64 RPM package']
  ])('labels %s without changing its path', (name, label) => {
    expect(releaseAssetUploadArgument(`release-assets/${name}`))
      .toBe(`release-assets/${name}#${label}`)
  })

  it('applies labels independently of the release version', () => {
    expect(releaseAssetUploadArgument('release-assets/hronaut-2.0.0-beta.1-x64-setup.exe'))
      .toBe('release-assets/hronaut-2.0.0-beta.1-x64-setup.exe#Windows x64 installer')
  })

  it('keeps updater, blockmap, and unknown artifacts unlabeled and ordered', () => {
    const paths = [
      'release-assets/latest.yml',
      'release-assets/latest-mac.yml',
      'release-assets/hronaut-1.11.35-x64-setup.exe.blockmap',
      'release-assets/Hronaut-1.11.35-mac.zip'
    ]

    expect(releaseAssetUploadArguments(paths)).toEqual(paths)
  })

  it.each([
    'release-assets/hronaut-1.11.35-x64-setup.exe#misleading',
    'release-assets/hronaut-1.11.35-x64-setup.exe\nother-file'
  ])('rejects a path that can alter the upload argument protocol: %j', (path) => {
    expect(() => releaseAssetUploadArgument(path)).toThrow('Invalid release asset path')
  })
})
