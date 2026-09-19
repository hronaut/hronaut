import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { releaseAssetUploadArgument } from './release-asset-labels.ts'

const DEFAULT_UPLOAD_TIMEOUT_MS = 10 * 60 * 1_000
const COMMAND_OUTPUT_LIMIT_BYTES = 1024 * 1024
const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:[+-][0-9A-Za-z.-]+)?$/u
const REPOSITORY_PATTERN = /^[0-9A-Za-z_.-]+\/[0-9A-Za-z_.-]+$/u
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const RETRYABLE_TRANSPORT_PATTERN = /(?:timed? out|timeout|connection reset|empty reply|unexpected eof|tls handshake|temporary failure|stream error|broken pipe)/iu

export interface ExpectedReleaseAsset {
  name: string
  path: string
  size: number
  digest: string
  uploadArgument: string
}

export interface RemoteReleaseAsset {
  id: number
  name: string
  size: number
  digest: string | null
  state: string
}

export interface ReleaseSnapshot {
  draft: boolean
  assets: RemoteReleaseAsset[]
}

export type UploadAttemptResult =
  | { status: 'succeeded' }
  | { status: 'failed', retryable: boolean, summary: string }

export interface ReleaseAssetPublisherAdapter {
  readRelease(): Promise<ReleaseSnapshot>
  uploadAsset(asset: ExpectedReleaseAsset): Promise<UploadAttemptResult>
  deleteAsset(id: number): Promise<void>
  publishRelease(): Promise<UploadAttemptResult>
  sleep(milliseconds: number): Promise<void>
}

export interface PublishReleaseAssetOptions {
  maxAttempts?: number
  backoffMs?: readonly number[]
}

export interface PublishReleaseAssetSummary {
  preserved: number
  uploaded: number
  retries: number
  verified: number
}

type AssetInspection =
  | { status: 'missing' }
  | { status: 'exact', asset: RemoteReleaseAsset }
  | { status: 'starter', asset: RemoteReleaseAsset }
  | { status: 'conflict', asset: RemoteReleaseAsset }

function inspectAsset(snapshot: ReleaseSnapshot, expected: ExpectedReleaseAsset): AssetInspection {
  const matches = snapshot.assets.filter((asset) => asset.name === expected.name)
  if (matches.length > 1) throw new Error(`Draft contains duplicate release asset ${expected.name}`)
  const asset = matches[0]
  if (!asset) return { status: 'missing' }
  if (asset.state === 'uploaded' && asset.size === expected.size && asset.digest === expected.digest) {
    return { status: 'exact', asset }
  }
  if (asset.state === 'starter') return { status: 'starter', asset }
  return { status: 'conflict', asset }
}

function assertDraft(snapshot: ReleaseSnapshot): void {
  if (!snapshot.draft) throw new Error('Release is already public; refusing asset mutation')
}

function assertExpectedAssetSet(snapshot: ReleaseSnapshot, expected: readonly ExpectedReleaseAsset[]): void {
  const expectedNames = new Set(expected.map((asset) => asset.name))
  for (const remote of snapshot.assets) {
    if (!expectedNames.has(remote.name)) throw new Error(`Draft contains unexpected release asset ${remote.name}`)
  }
  for (const asset of expected) {
    const inspection = inspectAsset(snapshot, asset)
    if (inspection.status !== 'exact') throw new Error(`Draft release asset ${asset.name} is not fully verified`)
  }
}

function validateExpectedAssets(expected: readonly ExpectedReleaseAsset[]): void {
  if (expected.length === 0) throw new Error('No release assets were supplied')
  const names = new Set<string>()
  for (const asset of expected) {
    if (!asset.name || names.has(asset.name)) throw new Error(`Duplicate or empty release asset name: ${asset.name}`)
    if (!Number.isSafeInteger(asset.size) || asset.size < 0) throw new Error(`Invalid release asset size for ${asset.name}`)
    if (!/^sha256:[0-9a-f]{64}$/u.test(asset.digest)) throw new Error(`Invalid release asset digest for ${asset.name}`)
    names.add(asset.name)
  }
}

function retryDelay(backoffMs: readonly number[], completedAttempts: number): number {
  const configured = backoffMs[Math.min(completedAttempts - 1, backoffMs.length - 1)]
  if (!Number.isSafeInteger(configured) || configured === undefined || configured < 0) {
    throw new Error('Release upload retry delays must be non-negative integers')
  }
  return configured
}

export async function publishReleaseAssets(
  expectedInput: readonly ExpectedReleaseAsset[],
  adapter: ReleaseAssetPublisherAdapter,
  options: PublishReleaseAssetOptions = {}
): Promise<PublishReleaseAssetSummary> {
  const expected = [...expectedInput].sort((left, right) => left.name.localeCompare(right.name))
  validateExpectedAssets(expected)
  const maxAttempts = options.maxAttempts ?? 3
  const backoffMs = options.backoffMs ?? [10_000, 30_000]
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error('Release upload attempt limit must be an integer from 1 to 10')
  }
  if (maxAttempts > 1 && backoffMs.length === 0) throw new Error('Release upload retry delays are required')

  const initial = await adapter.readRelease()
  assertDraft(initial)
  const expectedNames = new Set(expected.map((asset) => asset.name))
  const unexpected = initial.assets.find((asset) => !expectedNames.has(asset.name))
  if (unexpected) throw new Error(`Draft contains unexpected release asset ${unexpected.name}`)

  let preserved = 0
  let uploaded = 0
  let retries = 0

  for (const asset of expected) {
    let snapshot = await adapter.readRelease()
    assertDraft(snapshot)
    let inspection = inspectAsset(snapshot, asset)
    if (inspection.status === 'exact') {
      preserved += 1
      continue
    }
    if (inspection.status === 'conflict') {
      throw new Error(`Draft release asset ${asset.name} conflicts with the immutable build output`)
    }
    if (inspection.status === 'starter') {
      await adapter.deleteAsset(inspection.asset.id)
    }

    let verified = false
    let lastSummary = 'upload did not produce a verified asset'
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const result = await adapter.uploadAsset(asset)
      snapshot = await adapter.readRelease()
      assertDraft(snapshot)
      inspection = inspectAsset(snapshot, asset)
      if (inspection.status === 'exact') {
        uploaded += 1
        verified = true
        break
      }
      if (inspection.status === 'conflict') {
        throw new Error(`Draft release asset ${asset.name} conflicts with the immutable build output`)
      }

      const retryable = result.status === 'succeeded' || result.retryable
      lastSummary = result.status === 'succeeded'
        ? 'upload returned success without authoritative asset evidence'
        : result.summary
      if (!retryable) throw new Error(`Release asset ${asset.name} failed without retry: ${lastSummary}`)
      if (attempt >= maxAttempts) break
      if (inspection.status === 'starter') await adapter.deleteAsset(inspection.asset.id)
      retries += 1
      await adapter.sleep(retryDelay(backoffMs, attempt))
    }
    if (!verified) throw new Error(`Release asset ${asset.name} was not verified after ${maxAttempts} attempts: ${lastSummary}`)
  }

  const beforePublish = await adapter.readRelease()
  assertDraft(beforePublish)
  assertExpectedAssetSet(beforePublish, expected)
  const publication = await adapter.publishRelease()
  const afterPublish = await adapter.readRelease()
  if (afterPublish.draft) {
    const summary = publication.status === 'failed' ? `: ${publication.summary}` : ''
    throw new Error(`Release is still a draft after the publish command${summary}`)
  }
  assertExpectedAssetSet(afterPublish, expected)
  return { preserved, uploaded, retries, verified: expected.length }
}

interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  outputExceeded: boolean
}

async function runCommand(command: string, args: readonly string[], timeoutMs: number): Promise<CommandResult> {
  return await new Promise((resolveResult) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let outputExceeded = false
    let settled = false
    let forceKill: NodeJS.Timeout | undefined
    const stop = (): void => {
      child.kill('SIGTERM')
      forceKill ??= setTimeout(() => child.kill('SIGKILL'), 5_000)
    }
    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString('utf8')
      if (Buffer.byteLength(next) <= COMMAND_OUTPUT_LIMIT_BYTES) return next
      outputExceeded = true
      stop()
      return next.slice(-COMMAND_OUTPUT_LIMIT_BYTES)
    }
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
    const timeout = setTimeout(() => {
      timedOut = true
      stop()
    }, timeoutMs)
    const finish = (code: number | null, extraError = ''): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (forceKill) clearTimeout(forceKill)
      resolveResult({ code, stdout, stderr: extraError || stderr, timedOut, outputExceeded })
    }
    child.on('error', (error) => finish(null, error.message))
    child.on('close', (code) => finish(code))
  })
}

export function classifyReleaseUploadFailure(
  output: string,
  options: { timedOut?: boolean, outputExceeded?: boolean } = {}
): { summary: string, retryable: boolean } {
  if (options.timedOut) return { summary: 'upload attempt timed out', retryable: true }
  if (options.outputExceeded) return { summary: 'upload command exceeded its bounded output limit', retryable: false }
  const httpStatus = output.match(/\bHTTP\s+(\d{3})\b/iu)?.[1]
  if (httpStatus) {
    const status = Number(httpStatus)
    return { summary: `HTTP ${status}`, retryable: RETRYABLE_HTTP_STATUSES.has(status) }
  }
  if (RETRYABLE_TRANSPORT_PATTERN.test(output)) return { summary: 'transient upload transport failure', retryable: true }
  return { summary: 'upload command failed', retryable: false }
}

function parseRemoteAsset(value: unknown): RemoteReleaseAsset {
  if (!value || typeof value !== 'object') throw new Error('Release API returned an invalid asset')
  const asset = value as Record<string, unknown>
  if (!Number.isSafeInteger(asset.id) || typeof asset.name !== 'string' ||
      !Number.isSafeInteger(asset.size) || typeof asset.state !== 'string' ||
      !(typeof asset.digest === 'string' || asset.digest === null)) {
    throw new Error('Release API returned incomplete asset evidence')
  }
  return {
    id: asset.id as number,
    name: asset.name,
    size: asset.size as number,
    state: asset.state,
    digest: asset.digest as string | null
  }
}

export function releaseSnapshotFromList(value: unknown, tag: string): ReleaseSnapshot {
  if (!Array.isArray(value)) throw new Error('GitHub release list was invalid')
  const matches = value.filter((entry) => (
    entry !== null && typeof entry === 'object' && (entry as Record<string, unknown>).tag_name === tag
  ))
  if (matches.length !== 1) throw new Error('GitHub release list did not contain one exact tag')
  const release = matches[0] as Record<string, unknown>
  if (typeof release.draft !== 'boolean' || !Array.isArray(release.assets)) {
    throw new Error('GitHub release readback omitted required evidence')
  }
  return { draft: release.draft, assets: release.assets.map(parseRemoteAsset) }
}

class GitHubReleaseAdapter implements ReleaseAssetPublisherAdapter {
  private readonly tag: string
  private readonly repository: string
  private readonly uploadTimeoutMs: number

  constructor(
    tag: string,
    repository: string,
    uploadTimeoutMs: number
  ) {
    this.tag = tag
    this.repository = repository
    this.uploadTimeoutMs = uploadTimeoutMs
  }

  private async gh(args: readonly string[], timeoutMs = 30_000): Promise<CommandResult> {
    return await runCommand('gh', args, timeoutMs)
  }

  async readRelease(): Promise<ReleaseSnapshot> {
    const result = await this.gh([
      'api',
      `repos/${this.repository}/releases?per_page=100`,
      '--jq',
      `[.[] | select(.tag_name == "${this.tag}")]`
    ])
    if (result.code !== 0 || result.outputExceeded) throw new Error('GitHub release readback failed')
    let value: unknown
    try {
      value = JSON.parse(result.stdout)
    } catch {
      throw new Error('GitHub release readback was not valid JSON')
    }
    return releaseSnapshotFromList(value, this.tag)
  }

  async uploadAsset(asset: ExpectedReleaseAsset): Promise<UploadAttemptResult> {
    const result = await this.gh(
      ['release', 'upload', this.tag, asset.uploadArgument, '--repo', this.repository],
      this.uploadTimeoutMs
    )
    if (result.code === 0 && !result.outputExceeded) return { status: 'succeeded' }
    return {
      status: 'failed',
      ...classifyReleaseUploadFailure(`${result.stderr}\n${result.stdout}`, result)
    }
  }

  async deleteAsset(id: number): Promise<void> {
    const snapshot = await this.readRelease()
    assertDraft(snapshot)
    const result = await this.gh(['api', '--method', 'DELETE', `repos/${this.repository}/releases/assets/${id}`])
    if (result.code !== 0) throw new Error('GitHub rejected bounded starter-asset cleanup')
  }

  async publishRelease(): Promise<UploadAttemptResult> {
    const result = await this.gh(['release', 'edit', this.tag, '--repo', this.repository, '--draft=false'])
    if (result.code === 0 && !result.outputExceeded) return { status: 'succeeded' }
    return {
      status: 'failed',
      ...classifyReleaseUploadFailure(`${result.stderr}\n${result.stdout}`, result)
    }
  }

  async sleep(milliseconds: number): Promise<void> {
    await new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return `sha256:${hash.digest('hex')}`
}

async function expectedReleaseAssets(paths: readonly string[]): Promise<ExpectedReleaseAsset[]> {
  return await Promise.all(paths.map(async (path) => {
    let metadata
    try {
      metadata = await stat(path)
    } catch {
      throw new Error(`Release asset could not be read: ${basename(path)}`)
    }
    if (!metadata.isFile()) throw new Error(`Release asset is not a regular file: ${basename(path)}`)
    let digest: string
    try {
      digest = await sha256(path)
    } catch {
      throw new Error(`Release asset checksum could not be read: ${basename(path)}`)
    }
    return {
      name: basename(path),
      path,
      size: metadata.size,
      digest,
      uploadArgument: releaseAssetUploadArgument(path)
    }
  }))
}

function uploadTimeoutFromEnvironment(): number {
  const raw = process.env.HRONAUT_RELEASE_UPLOAD_TIMEOUT_MS
  if (!raw) return DEFAULT_UPLOAD_TIMEOUT_MS
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 30 * 60 * 1_000) {
    throw new Error('HRONAUT_RELEASE_UPLOAD_TIMEOUT_MS must be from 1000 to 1800000')
  }
  return value
}

async function main(): Promise<void> {
  const [tag = '', repository = '', ...paths] = process.argv.slice(2)
  if (!RELEASE_TAG_PATTERN.test(tag) || !REPOSITORY_PATTERN.test(repository) || paths.length === 0) {
    throw new Error('Usage: node scripts/release-asset-publisher.ts <vX.Y.Z tag> <owner/repository> <asset> [...]')
  }
  const expected = await expectedReleaseAssets(paths)
  const adapter = new GitHubReleaseAdapter(tag, repository, uploadTimeoutFromEnvironment())
  const summary = await publishReleaseAssets(expected, adapter)
  console.log(`Release asset recovery complete: preserved ${summary.preserved}, uploaded ${summary.uploaded}, retried ${summary.retries}, verified ${summary.verified}; ${tag} is public.`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown release publication failure'
    const nextStep = message.includes('already public')
      ? 'No release mutation was attempted.'
      : 'The draft remains the resume point; rerun the failed publish job after correcting any nonretryable error.'
    console.error(`Release publication stopped: ${message}. ${nextStep}`)
    process.exitCode = 1
  })
}
