import { describe, expect, it } from 'vitest'
import {
  classifyReleaseUploadFailure,
  publishReleaseAssets,
  releaseSnapshotFromList,
  type ExpectedReleaseAsset,
  type ReleaseAssetPublisherAdapter,
  type ReleaseSnapshot,
  type UploadAttemptResult
} from '../scripts/release-asset-publisher.js'

const expectedAsset = (name: string): ExpectedReleaseAsset => ({
  name,
  path: `release-assets/${name}`,
  size: name.length * 100,
  digest: `sha256:${'a'.repeat(64)}`,
  uploadArgument: `release-assets/${name}#${name} label`
})

const uploadedAsset = (asset: ExpectedReleaseAsset, id = 1) => ({
  id,
  name: asset.name,
  size: asset.size,
  digest: asset.digest,
  state: 'uploaded'
})

class FakeAdapter implements ReleaseAssetPublisherAdapter {
  snapshot: ReleaseSnapshot = { draft: true, assets: [] }
  readonly uploads: string[] = []
  readonly deleted: number[] = []
  readonly sleeps: number[] = []
  publishCalls = 0
  leaveDraftAfterPublish = false
  publicationResult: UploadAttemptResult = { status: 'succeeded' }
  uploadPlan: Array<(asset: ExpectedReleaseAsset) => UploadAttemptResult> = []

  async readRelease(): Promise<ReleaseSnapshot> {
    return structuredClone(this.snapshot)
  }

  async uploadAsset(asset: ExpectedReleaseAsset): Promise<UploadAttemptResult> {
    this.uploads.push(asset.name)
    const next = this.uploadPlan.shift()
    if (!next) throw new Error(`Unexpected upload for ${asset.name}`)
    return next(asset)
  }

  async deleteAsset(id: number): Promise<void> {
    this.deleted.push(id)
    this.snapshot.assets = this.snapshot.assets.filter((asset) => asset.id !== id)
  }

  async publishRelease(): Promise<UploadAttemptResult> {
    this.publishCalls += 1
    if (!this.leaveDraftAfterPublish) this.snapshot.draft = false
    return this.publicationResult
  }

  async sleep(milliseconds: number): Promise<void> {
    this.sleeps.push(milliseconds)
  }

  saveAndSucceed = (asset: ExpectedReleaseAsset): UploadAttemptResult => {
    this.snapshot.assets.push(uploadedAsset(asset, this.snapshot.assets.length + 1))
    return { status: 'succeeded' }
  }
}

describe('release asset publisher', () => {
  it('finds an authenticated draft in the bounded release list', () => {
    expect(releaseSnapshotFromList([
      { tag_name: 'v2.4.25', draft: false, assets: [] },
      { tag_name: 'v2.4.26', draft: true, assets: [] }
    ], 'v2.4.26')).toEqual({ draft: true, assets: [] })
  })

  it('reconciles a transient failure before retrying and publishes only after exact verification', async () => {
    const adapter = new FakeAdapter()
    const asset = expectedAsset('one.bin')
    adapter.uploadPlan = [
      () => ({ status: 'failed', retryable: true, summary: 'HTTP 500' }),
      adapter.saveAndSucceed
    ]

    const result = await publishReleaseAssets([asset], adapter, { maxAttempts: 3, backoffMs: [10, 20] })

    expect(adapter.uploads).toEqual(['one.bin', 'one.bin'])
    expect(adapter.sleeps).toEqual([10])
    expect(adapter.publishCalls).toBe(1)
    expect(result).toEqual({ preserved: 0, uploaded: 1, retries: 1, verified: 1 })
  })

  it('accepts an exact asset saved before an ambiguous response without replaying the upload', async () => {
    const adapter = new FakeAdapter()
    const asset = expectedAsset('saved.bin')
    adapter.uploadPlan = [(value) => {
      adapter.snapshot.assets.push(uploadedAsset(value, 41))
      return { status: 'failed', retryable: true, summary: 'connection reset after upload' }
    }]

    await expect(publishReleaseAssets([asset], adapter)).resolves.toMatchObject({ uploaded: 1, retries: 0 })
    expect(adapter.uploads).toEqual(['saved.bin'])
    expect(adapter.publishCalls).toBe(1)
  })

  it('preserves completed assets and uploads only the missing member of a partial draft', async () => {
    const first = expectedAsset('first.bin')
    const second = expectedAsset('second.bin')
    const adapter = new FakeAdapter()
    adapter.snapshot.assets = [uploadedAsset(first, 1)]
    adapter.uploadPlan = [adapter.saveAndSucceed]

    const result = await publishReleaseAssets([first, second], adapter)

    expect(adapter.uploads).toEqual(['second.bin'])
    expect(result).toMatchObject({ preserved: 1, uploaded: 1, verified: 2 })
    expect(adapter.publishCalls).toBe(1)
  })

  it.each([
    ['invalid request', 'HTTP 400'],
    ['expired credentials', 'HTTP 401'],
    ['insufficient permission', 'HTTP 403']
  ])('does not retry a nonretryable %s failure', async (_label, summary) => {
    const adapter = new FakeAdapter()
    const asset = expectedAsset('blocked.bin')
    adapter.uploadPlan = [() => ({ status: 'failed', retryable: false, summary })]

    await expect(publishReleaseAssets([asset], adapter)).rejects.toThrow(summary)
    expect(adapter.uploads).toEqual(['blocked.bin'])
    expect(adapter.sleeps).toEqual([])
    expect(adapter.publishCalls).toBe(0)
  })

  it('stops after the bounded transient-failure budget is exhausted', async () => {
    const adapter = new FakeAdapter()
    const asset = expectedAsset('flaky.bin')
    adapter.uploadPlan = Array.from({ length: 3 }, () => (
      () => ({ status: 'failed', retryable: true, summary: 'HTTP 503' }) as const
    ))

    await expect(publishReleaseAssets([asset], adapter, { maxAttempts: 3, backoffMs: [5, 15] }))
      .rejects.toThrow('after 3 attempts')
    expect(adapter.uploads).toHaveLength(3)
    expect(adapter.sleeps).toEqual([5, 15])
    expect(adapter.publishCalls).toBe(0)
  })

  it('removes only a same-name starter left by a transient attempt before retrying', async () => {
    const adapter = new FakeAdapter()
    const asset = expectedAsset('starter.bin')
    adapter.uploadPlan = [
      (value) => {
        adapter.snapshot.assets.push({ ...uploadedAsset(value, 99), state: 'starter', size: 0, digest: null })
        return { status: 'failed', retryable: true, summary: 'transport timeout' }
      },
      adapter.saveAndSucceed
    ]

    await publishReleaseAssets([asset], adapter, { maxAttempts: 2, backoffMs: [1] })

    expect(adapter.deleted).toEqual([99])
    expect(adapter.uploads).toEqual(['starter.bin', 'starter.bin'])
    expect(adapter.publishCalls).toBe(1)
  })

  it('refuses to replace a conflicting completed asset', async () => {
    const adapter = new FakeAdapter()
    const asset = expectedAsset('conflict.bin')
    adapter.snapshot.assets = [{ ...uploadedAsset(asset), digest: `sha256:${'f'.repeat(64)}` }]

    await expect(publishReleaseAssets([asset], adapter)).rejects.toThrow('conflicts with the immutable build output')
    expect(adapter.uploads).toEqual([])
    expect(adapter.deleted).toEqual([])
    expect(adapter.publishCalls).toBe(0)
  })

  it('blocks publication when the draft contains an unexpected asset', async () => {
    const adapter = new FakeAdapter()
    const asset = expectedAsset('expected.bin')
    adapter.snapshot.assets = [uploadedAsset(asset), uploadedAsset(expectedAsset('unexpected.bin'), 2)]

    await expect(publishReleaseAssets([asset], adapter)).rejects.toThrow('unexpected release asset')
    expect(adapter.publishCalls).toBe(0)
  })

  it('refuses an already-public release without uploading or publishing', async () => {
    const adapter = new FakeAdapter()
    adapter.snapshot.draft = false

    await expect(publishReleaseAssets([expectedAsset('one.bin')], adapter)).rejects.toThrow('already public')
    expect(adapter.uploads).toEqual([])
    expect(adapter.publishCalls).toBe(0)
  })

  it('requires authoritative readback that publication cleared the draft flag', async () => {
    const adapter = new FakeAdapter()
    const asset = expectedAsset('one.bin')
    adapter.snapshot.assets = [uploadedAsset(asset)]
    adapter.leaveDraftAfterPublish = true

    await expect(publishReleaseAssets([asset], adapter)).rejects.toThrow('still a draft')
    expect(adapter.publishCalls).toBe(1)
  })

  it('accepts a failed publication response only when readback proves the release became public', async () => {
    const adapter = new FakeAdapter()
    const asset = expectedAsset('one.bin')
    adapter.snapshot.assets = [uploadedAsset(asset)]
    adapter.publicationResult = { status: 'failed', retryable: true, summary: 'HTTP 500' }

    await expect(publishReleaseAssets([asset], adapter)).resolves.toMatchObject({ verified: 1 })
    expect(adapter.publishCalls).toBe(1)
  })
})

describe('release upload failure classification', () => {
  it.each([400, 401, 403, 404, 422])('does not retry HTTP %i', (status) => {
    expect(classifyReleaseUploadFailure(`HTTP ${status}: request rejected`))
      .toEqual({ summary: `HTTP ${status}`, retryable: false })
  })

  it.each([408, 425, 429, 500, 502, 503, 504])('retries eligible transient HTTP %i', (status) => {
    expect(classifyReleaseUploadFailure(`HTTP ${status}: temporary failure`))
      .toEqual({ summary: `HTTP ${status}`, retryable: true })
  })

  it('retries bounded timeouts and transport resets without exposing raw output', () => {
    expect(classifyReleaseUploadFailure('private request details', { timedOut: true }))
      .toEqual({ summary: 'upload attempt timed out', retryable: true })
    expect(classifyReleaseUploadFailure('connection reset by peer with private request details'))
      .toEqual({ summary: 'transient upload transport failure', retryable: true })
  })

  it('does not retry unknown failures or unbounded command output', () => {
    expect(classifyReleaseUploadFailure('unknown failure'))
      .toEqual({ summary: 'upload command failed', retryable: false })
    expect(classifyReleaseUploadFailure('private output', { outputExceeded: true }))
      .toEqual({ summary: 'upload command exceeded its bounded output limit', retryable: false })
  })
})
