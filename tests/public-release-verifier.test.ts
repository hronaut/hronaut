import { describe, expect, it, vi } from 'vitest'
import {
  PUBLIC_RELEASE_ASSET_KEYS,
  parsePublicReleaseManifest,
  verifyPublicRelease,
  waitForPublicRelease
} from '../scripts/verify-public-release.js'

const version = '9.8.7'

function assetNames(): Record<(typeof PUBLIC_RELEASE_ASSET_KEYS)[number], string> {
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

function manifest(releaseVersion = version) {
  const names = assetNames()
  return {
    version: releaseVersion,
    tag: `v${releaseVersion}`,
    url: `https://github.com/hronaut/hronaut/releases/tag/v${releaseVersion}`,
    publishedAt: '2026-08-25T18:40:32Z',
    summary: 'A complete public Hronaut release.',
    assets: Object.fromEntries(PUBLIC_RELEASE_ASSET_KEYS.map((key, index) => [key, {
      name: names[key].replace(version, releaseVersion),
      url: `https://github.com/hronaut/hronaut/releases/download/v${releaseVersion}/${names[key].replace(version, releaseVersion)}`,
      size: index + 1
    }]))
  }
}

function releaseFetcher(releaseManifest = manifest()): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/api/release') return Response.json(releaseManifest)
    const destination = url.pathname === '/releases/latest'
      ? releaseManifest.url
      : releaseManifest.assets[url.pathname.slice('/releases/'.length) as keyof typeof releaseManifest.assets]?.url
    return new Response(null, {
      status: destination && init?.method === 'HEAD' ? 302 : 404,
      headers: destination ? { location: destination } : undefined
    })
  }) as unknown as typeof fetch
}

describe('public release verifier', () => {
  it('verifies the current manifest and every public download redirect', async () => {
    const fetcher = releaseFetcher()

    const release = await verifyPublicRelease({ version, fetcher })

    expect(release.tag).toBe(`v${version}`)
    expect(fetcher).toHaveBeenCalledTimes(PUBLIC_RELEASE_ASSET_KEYS.length + 2)
  })

  it('rejects stale or incomplete public manifests before accepting a release', () => {
    expect(() => parsePublicReleaseManifest(manifest('9.8.6'), version)).toThrow(
      'hronaut.dev resolves v9.8.6, expected v9.8.7'
    )
    const incomplete = manifest()
    delete incomplete.assets.hashes
    expect(() => parsePublicReleaseManifest(incomplete, version)).toThrow('incomplete asset map')
  })

  it('rejects a public route that does not resolve the published artifact', async () => {
    const fetcher = releaseFetcher()
    vi.mocked(fetcher).mockImplementationOnce(async () => Response.json(manifest()))
    vi.mocked(fetcher).mockImplementationOnce(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://github.com/hronaut/hronaut/releases/tag/v9.8.6' }
    }))

    await expect(verifyPublicRelease({ version, fetcher })).rejects.toThrow(
      '/releases/latest does not redirect to the published release'
    )
  })

  it('retries a stale edge response and succeeds when the public release catches up', async () => {
    const stale = releaseFetcher(manifest('9.8.6'))
    const current = releaseFetcher()
    let requestCount = 0
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => (
      ++requestCount === 1 ? stale(input, init) : current(input, init)
    )) as unknown as typeof fetch
    const sleep = vi.fn(async () => undefined)

    const release = await waitForPublicRelease({
      version,
      fetcher,
      attempts: 2,
      retryDelayMs: 1,
      sleep
    })

    expect(release.tag).toBe(`v${version}`)
    expect(sleep).toHaveBeenCalledOnce()
  })
})
