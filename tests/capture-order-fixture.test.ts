import { writeFile, access } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import type { TestInfo } from '@playwright/test'
import { beginCaptureCollection, captureDiagnosticPath, finishCaptureCollection } from './integration/capture-order-diagnostic.js'
import { CaptureRing } from '../src/main/capture-order-state.js'
afterEach(() => vi.unstubAllEnvs())
it('collects each bounded launch after shutdown, marks missing processes, exports no paths and removes temporary files', async () => {
  vi.stubEnv('HRONAUT_CAPTURE_DIAGNOSTIC', '1')
  const attach = vi.fn()
  const info = { attach } as unknown as TestInfo
  await beginCaptureCollection(info)
  const path = captureDiagnosticPath(info)!
  const state = new CaptureRing()
  state.record({ event: 'installed', ms: 0, preexisting: 0 })
  state.record({ event: 'will-quit', ms: 2 })
  await writeFile(path, JSON.stringify(state.snapshot()))
  captureDiagnosticPath(info)
  await finishCaptureCollection(info)
  const payload = JSON.parse(attach.mock.calls[0]![1].body)
  expect(payload.processes[0].data.willQuit).toBe(true)
  expect(payload.processes[1]).toEqual({ missing: true })
  expect(JSON.stringify(payload)).not.toContain(path)
  await expect(access(path)).rejects.toThrow()
})
it('caps launches and rejects unexpected on-disk fields', async () => {
  vi.stubEnv('HRONAUT_CAPTURE_DIAGNOSTIC', '1')
  const attach = vi.fn()
  const info = { attach } as unknown as TestInfo
  await beginCaptureCollection(info)
  const path = captureDiagnosticPath(info)!
  await writeFile(path, JSON.stringify({ ...new CaptureRing().snapshot(), secret: 'private' }))
  for (let i = 0; i < 5; i++) captureDiagnosticPath(info)
  await finishCaptureCollection(info)
  const payload = JSON.parse(attach.mock.calls[0]![1].body)
  expect(payload.processes).toHaveLength(4)
  expect(payload.omittedProcesses).toBe(2)
  expect(payload.processes[0]).toEqual({ omitted: true })
  expect(JSON.stringify(payload)).not.toContain('private')
})
