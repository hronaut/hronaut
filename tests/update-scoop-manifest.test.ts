import { describe, expect, it } from 'vitest'
import {
  releaseAssetSha256,
  scoopPortableAssetName,
  updateScoopManifestSource
} from '../scripts/update-scoop-manifest.js'

const version = '2.4.1'
const filename = `hronaut-${version}-x64-windows-portable.exe`
const oldHash = '1'.repeat(64)
const releasedHash = 'a'.repeat(64)

function manifest(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    version,
    description: 'Hronaut',
    architecture: {
      '64bit': {
        url: `https://github.com/hronaut/hronaut/releases/download/v${version}/${filename}`,
        hash: oldHash
      }
    },
    shortcuts: [[filename, 'Hronaut']],
    ...overrides
  }, null, 2)}\n`
}

describe('Scoop release manifest updater', () => {
  it('updates only the portable hash from the published checksum manifest', () => {
    const source = manifest()
    const next = updateScoopManifestSource(source, version, [
      `${'b'.repeat(64)}  hashes.txt`,
      `${releasedHash}  ${filename}`,
      `${'c'.repeat(64)}  latest.yml`
    ].join('\n'))

    expect(JSON.parse(next)).toEqual({
      ...JSON.parse(source),
      architecture: {
        '64bit': {
          url: `https://github.com/hronaut/hronaut/releases/download/v${version}/${filename}`,
          hash: releasedHash
        }
      }
    })
    expect(next).toBe(source.replace(oldHash, releasedHash))
    expect(updateScoopManifestSource(next, version, `${releasedHash}  ${filename}`)).toBe(next)
  })

  it('requires one exact well-formed checksum entry', () => {
    expect(() => releaseAssetSha256(`${releasedHash}  another.exe`, filename))
      .toThrow(`found 0`)
    expect(() => releaseAssetSha256(`${releasedHash} ${filename}`, filename))
      .toThrow('Malformed SHA-256 manifest line')
    expect(() => releaseAssetSha256([
      `${releasedHash}  ${filename}`,
      `${releasedHash}  ${filename}`
    ].join('\n'), filename)).toThrow('found 2')
  })

  it('refuses stale or structurally unexpected manifests', () => {
    expect(() => updateScoopManifestSource(manifest({ version: '2.4.0' }), version, `${releasedHash}  ${filename}`))
      .toThrow('does not match release')
    expect(() => updateScoopManifestSource(manifest({ shortcuts: [['wrong.exe', 'Hronaut']] }), version, `${releasedHash}  ${filename}`))
      .toThrow('shortcut does not match')
    expect(() => updateScoopManifestSource(manifest({
      architecture: { '64bit': { url: 'https://example.test/wrong.exe', hash: oldHash } }
    }), version, `${releasedHash}  ${filename}`)).toThrow('URL does not match')
  })

  it('builds only safe release asset names', () => {
    expect(scoopPortableAssetName('2.4.1')).toBe(filename)
    expect(() => scoopPortableAssetName('../bad')).toThrow('Invalid release version')
  })
})
