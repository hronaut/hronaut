import { openSync, closeSync, fstatSync, readSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { assertPlainPath, verifyLoadedBundle, type CaptureManifest } from './protocol-capture-loader.ts'

export function readBoundedFile(path: string, maxBytes: number): Buffer {
  const fd = openSync(path, 'r')
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > maxBytes) throw 0
    const bytes = Buffer.alloc(maxBytes + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null)
      if (!count) break
      length += count
    }
    if (length > maxBytes) throw 0
    return bytes.subarray(0, length)
  } finally { closeSync(fd) }
}

export const MAX_ARTIFACT_BYTES = 256 * 1024
export interface NumericCapture { status: number; reason: number; total: number; dropped: number; transports: number; rows: number[][] }
export const unknownCapture = (reason = 1): NumericCapture => ({ status: 0, reason, total: 0, dropped: 0, transports: 0, rows: [] })
const integer = (n: unknown, min: number, max = Number.MAX_SAFE_INTEGER): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max
function values(value: unknown, keys: string[]): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw 0
  return keys.map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) throw 0
    return descriptor.value
  })
}

export function sanitizeSnapshot(input: unknown): NumericCapture {
  try {
    const [capacity, total, dropped, transports, rejected, errors, rows] = values(input,
      ['capacity', 'total', 'dropped', 'transports', 'rejectedTransports', 'observerErrors', 'rows'])
    if (capacity !== 2048 || !integer(total, 0) || !integer(dropped, 0) || !integer(transports, 1, 63) || rejected !== 0 || errors !== 0 || !Array.isArray(rows) || rows.length !== Math.min(2048, total) || dropped !== total - rows.length) return unknownCapture(2)
    if (!rows.length) return unknownCapture(3)
    const clean: number[][] = []
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 7 || Object.keys(row).length !== 7) return unknownCapture(2)
      const numbers = Array.from({ length: 7 }, (_, i) => Object.getOwnPropertyDescriptor(row, String(i))?.value as unknown)
      if (!integer(numbers[0], 1, 9) || !integer(numbers[1], 1, transports) || !integer(numbers[2], 1, 2) || !integer(numbers[3], 0) || !integer(numbers[4], 0) || !integer(numbers[5], 0, 9) || typeof numbers[6] !== 'number' || !Number.isFinite(numbers[6]) || numbers[6] < 0 || numbers[6] > Number.MAX_SAFE_INTEGER) return unknownCapture(2)
      clean.push(numbers as number[])
    }
    const result = { status: dropped ? 2 : 1, reason: 0, total, dropped, transports, rows: clean }
    return Buffer.byteLength(JSON.stringify(result)) <= MAX_ARTIFACT_BYTES ? result : unknownCapture(4)
  } catch { return unknownCapture(2) }
}

export function readCaptureFile(path: string): NumericCapture {
  try {
    const data = readBoundedFile(path, MAX_ARTIFACT_BYTES)
    if (data.byteLength > MAX_ARTIFACT_BYTES) return unknownCapture(4)
    const parsed: unknown = JSON.parse(data.toString('utf8'))
    const [status, reason, total, dropped, transports, rows] = values(parsed, ['status', 'reason', 'total', 'dropped', 'transports', 'rows'])
    if (status === 0 && integer(reason, 1, 4) && total === 0 && dropped === 0 && transports === 0 && Array.isArray(rows) && rows.length === 0) return unknownCapture(reason)
    const sanitized = sanitizeSnapshot({ capacity: 2048, total, dropped, transports, rows, rejectedTransports: 0, observerErrors: 0 })
    return reason === 0 && sanitized.status === status ? sanitized : unknownCapture(2)
  } catch { return unknownCapture() }
}

// Called synchronously from the selected case's ORIGINAL finally, before any
// client/server/fixture cleanup. No CDP calls; never replace the original error.
export function captureBeforeCleanup(snapshot: () => unknown, write: (data: string) => void): void {
  let result: NumericCapture
  try { result = sanitizeSnapshot(snapshot()) } catch { result = unknownCapture(2) }
  try { write(JSON.stringify(result)) } catch { /* Parent reports missing artifact as unknown. */ }
}

export function collectBeforeCleanup(retry: number): void {
  try {
    if (retry !== 0 && retry !== 1) return
    const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')
    const manifestPath = join(root, 'scripts/diagnostics/capture-manifest.json')
    assertPlainPath(root, manifestPath)
    const raw = readBoundedFile(manifestPath, 4096)
    if (raw.byteLength > 4096) return
    const manifest: CaptureManifest = JSON.parse(raw.toString('utf8'))
    if (manifest.root !== root) return
    const directory = join(root, 'diagnostic-output')
    assertPlainPath(root, directory)
    captureBeforeCleanup(() => verifyLoadedBundle(manifest, createRequire(import.meta.url).cache)(),
      data => writeFileSync(join(directory, `attempt-${retry}.json`), data, { flag: 'wx', mode: 0o600 }))
  } catch { /* Missing worker snapshot is an explicit unknown at collection. */ }
}
