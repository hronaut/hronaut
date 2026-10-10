// Diagnostic branch only. The probe is installed in main before native windows exist.
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestInfo } from '@playwright/test'
import type { CaptureDiagnosticGlobal } from '../../src/main/capture-order-diagnostic.js'
import { projectSnapshot } from '../../src/main/capture-order-state.js'
export type { CaptureDiagnosticGlobal }
const contexts = new WeakMap<TestInfo, { directory: string; paths: string[]; omitted: number }>()
export async function beginCaptureCollection(info: TestInfo): Promise<void> {
  if (process.env.HRONAUT_CAPTURE_DIAGNOSTIC !== '1') return
  contexts.set(info, { directory: await mkdtemp(join(tmpdir(), 'capture-diagnostic-')), paths: [], omitted: 0 })
}
export function captureDiagnosticPath(info: TestInfo): string | undefined {
  const context = contexts.get(info)
  if (!context) return
  if (context.paths.length >= 4) { context.omitted++; return }
  const path = join(context.directory, `${context.paths.length + 1}.json`)
  context.paths.push(path)
  return path
}
export async function finishCaptureCollection(info: TestInfo): Promise<void> {
  const context = contexts.get(info)
  if (!context) return
  try {
    const processes = []
    for (const path of context.paths) {
      try {
        if ((await stat(path)).size > 256 * 1024) { processes.push({ omitted: true }); continue }
        const data = projectSnapshot(JSON.parse(await readFile(path, 'utf8')))
        processes.push(data ? { data } : { omitted: true })
      } catch { processes.push({ missing: true }) }
    }
    await info.attach('bounded-native-capture-events', {
      body: JSON.stringify({ processes, omittedProcesses: context.omitted }), contentType: 'application/json'
    })
  } finally { contexts.delete(info); await rm(context.directory, { recursive: true, force: true }) }
}
