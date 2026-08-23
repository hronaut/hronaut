import { describe, expect, it } from 'vitest'
import {
  buildLinuxUpdateManifest,
  formatLinuxUpdateManifest,
  type LinuxUpdateAsset
} from '../scripts/linux-update-manifests.js'

const assets: LinuxUpdateAsset[] = [
  { name: 'hronaut-2.18.1-x86_64.AppImage', sha512: 'x64-appimage', size: 101 },
  { name: 'hronaut-2.18.1-amd64.deb', sha512: 'x64-deb', size: 102 },
  { name: 'hronaut-2.18.1-x86_64.rpm', sha512: 'x64-rpm', size: 103 },
  { name: 'hronaut-2.18.1-arm64.AppImage', sha512: 'arm-appimage', size: 201 },
  { name: 'hronaut-2.18.1-arm64.deb', sha512: 'arm-deb', size: 202 },
  { name: 'hronaut-2.18.1-aarch64.rpm', sha512: 'arm-rpm', size: 203 }
]

describe('Linux updater manifests', () => {
  it.each([
    ['x64', ['hronaut-2.18.1-x86_64.AppImage', 'hronaut-2.18.1-amd64.deb', 'hronaut-2.18.1-x86_64.rpm']],
    ['arm64', ['hronaut-2.18.1-arm64.AppImage', 'hronaut-2.18.1-arm64.deb', 'hronaut-2.18.1-aarch64.rpm']]
  ] as const)('includes every compatible %s package', (architecture, expectedNames) => {
    const manifest = buildLinuxUpdateManifest('2.18.1', architecture, assets, '2026-08-15T18:00:00.000Z')
    expect(manifest.files.map((file) => file.name)).toEqual(expectedNames)
    expect(manifest.path).toBe(expectedNames[0])
    expect(formatLinuxUpdateManifest(manifest)).toContain(`  - url: ${expectedNames[1]}`)
  })

  it('fails the release when one package type is missing', () => {
    expect(() => buildLinuxUpdateManifest('2.18.1', 'x64', assets.filter((asset) => !asset.name.endsWith('.deb'))))
      .toThrow('Expected exactly one x64 deb asset, found 0')
  })

  it('fails the release when an architecture has duplicate package assets', () => {
    expect(() => buildLinuxUpdateManifest('2.18.1', 'arm64', [
      ...assets,
      { name: 'hronaut-2.18.1-aarch64.AppImage', sha512: 'duplicate', size: 204 }
    ])).toThrow('Expected exactly one arm64 AppImage asset, found 2')
  })
})
