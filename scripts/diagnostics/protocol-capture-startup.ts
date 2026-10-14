import { existsSync, openSync, closeSync, fstatSync, readSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

function boundedRead(path: string): string {
  const fd = openSync(path, 'r')
  try {
    if (!fstatSync(fd).isFile() || fstatSync(fd).size > 8192) throw 0
    const buffer = Buffer.alloc(8193)
    let size = 0
    while (size < buffer.length) { const n = readSync(fd, buffer, size, buffer.length - size, null); if (!n) break; size += n }
    if (size > 8192) throw 0
    return buffer.subarray(0, size).toString('utf8')
  } finally { closeSync(fd) }
}

// Stages: 1 package resolution, 2 driver runtime, 3 existing preload bridge use,
// 4 Xvfb spawn, 5 display readiness, 6 Electron spawn/launch, 7 Electron exit,
// 8 Electron initialization, 9 fixture admission, 10 Node exit, 11 test result.
// States: 1 begin, 2 success, 3 failure, 4 exit. No free-form diagnostic strings.
const integer = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max
export function startupReason(error: unknown): number {
  try {
    if (!error || typeof error !== 'object') return 0
    const code = Object.getOwnPropertyDescriptor(error, 'code')?.value
    switch (code) {
      case 'ENOENT': return 1
      case 'EACCES': return 2
      case 'EPERM': return 3
      case 'ENOSPC': return 4
      case 'ECONNREFUSED': return 5
      case 'ERR_MODULE_NOT_FOUND': return 6
      case 'MODULE_NOT_FOUND': return 7
    }
    const name = Object.getOwnPropertyDescriptor(error, 'name')?.value
    return name === 'TimeoutError' ? 8 : name === 'AbortError' ? 9 : 0
  } catch { return 0 }
}
export function startupSignal(signal: unknown): number {
  return signal === 'SIGKILL' ? 11 : signal === 'SIGTERM' ? 12 : signal === 'SIGINT' ? 13 : 0
}
export function validStartupRows(input: unknown): input is number[][] {
  return Array.isArray(input) && input.length <= 32 && input.every(row => Array.isArray(row) && row.length === 6
    && integer(row[0], 1, 11) && integer(row[1], 1, 4) && integer(row[2], 0, 13)
    && integer(row[3], -1, 255) && integer(row[4], -1, 1)
    && typeof row[5] === 'number' && Number.isFinite(row[5]) && row[5] >= 0 && row[5] <= Number.MAX_SAFE_INTEGER)
}

// Startup/exit boundaries only, never called from protocol send/receive paths.
export function recordStartup(stage: number, state: number, reason = 0, exitCode: unknown = -1): void {
  try {
    const worker = process.env.TEST_WORKER_INDEX === '0' ? 0 : process.env.TEST_WORKER_INDEX === '1' ? 1 : -1
    const row = [stage, state, reason, integer(exitCode, 0, 255) ? exitCode : -1, worker, performance.now()]
    if (!validStartupRows([row])) return
    const path = join(process.cwd(), 'diagnostic-output', `startup-${process.pid}.json`)
    let rows: number[][] = []
    if (existsSync(path)) {
      const previous: unknown = JSON.parse(boundedRead(path))
      if (!validStartupRows(previous)) return
      rows = previous
    }
    // Preserve earliest setup evidence; reaching the cap is explicit in output.
    if (rows.length === 32) return
    rows.push(row)
    writeFileSync(path, JSON.stringify(rows), { mode: 0o600 })
  } catch { /* Collection must never replace the original setup/cleanup error. */ }
}

export function readStartup(root: string): { status: number; processes: { pid: number; capped: number; rows: number[][] }[] } {
  try {
    const directory = join(root, 'diagnostic-output')
    const names = readdirSync(directory).filter(name => /^startup-[1-9][0-9]{0,9}\.json$/.test(name))
    if (!names.length || names.length > 8) return { status: 0, processes: [] }
    const processes = names.sort().map(name => {
      const path = join(directory, name)
      const rows: unknown = JSON.parse(boundedRead(path))
      if (!validStartupRows(rows)) throw 0
      return { pid: Number(name.slice(8, -5)), capped: rows.length === 32 ? 1 : 0, rows }
    })
    return { status: 1, processes }
  } catch { return { status: 0, processes: [] } }
}
