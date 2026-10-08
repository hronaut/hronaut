import { readFile } from 'node:fs/promises'
import type { ElectronApplication, TestInfo } from '@playwright/test'

interface ProbeGlobals { __continuityResizeProbe?: { stop(): void } }

/** Diagnostic branch only: no page text, URLs, arguments, environment, or main/renderer timers. */
export async function continuityResizeDiagnostics(app: ElectronApplication, info: TestInfo) {
  if (process.env.HRONAUT_CONTINUITY_RESIZE_DIAGNOSTICS !== 'true') return undefined
  const nativePath = info.outputPath('continuity-native.jsonl')
  const rendererPid = await app.evaluate(({ BrowserWindow }, file) => {
    const { appendFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
    const window = BrowserWindow.getAllWindows()[0]!
    let count = 0
    const mark = (event: string, dimensions?: number[]) => {
      if (count++ < 128) appendFileSync(file, JSON.stringify({ time: Date.now(), event, dimensions }) + '\n')
    }
    const original = window.setSize
    window.setSize = function (...args: Parameters<typeof original>) {
      mark('setSize:start', args.slice(0, 2) as number[])
      const result = original.apply(this, args)
      mark('setSize:end', this.getContentSize())
      return result
    }
    const resized = () => mark('resize')
    const unresponsive = () => mark('unresponsive')
    const responsive = () => mark('responsive')
    window.on('resize', resized)
    window.on('unresponsive', unresponsive)
    window.on('responsive', responsive)
    ;(globalThis as typeof globalThis & ProbeGlobals).__continuityResizeProbe = { stop: () => {
      window.setSize = original
      window.off('resize', resized)
      window.off('unresponsive', unresponsive)
      window.off('responsive', responsive)
    } }
    mark('installed')
    return window.webContents.getOSProcessId()
  }, nativePath)
  const mainPid = app.process().pid!
  const operations: object[] = []
  const samples: object[] = []
  const record = (value: object) => { operations.push(value); if (operations.length > 128) operations.shift() }
  const processState = async (pid: number) => {
    try {
      const [stat, wchan] = await Promise.all([readFile(`/proc/${pid}/stat`, 'utf8'), readFile(`/proc/${pid}/wchan`, 'utf8')])
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      return { state: fields[0], userTicks: Number(fields[11]), systemTicks: Number(fields[12]),
        threads: Number(fields[17]), residentPages: Number(fields[21]), wchan: wchan.slice(0, 80) }
    } catch { return { unavailable: true } }
  }
  const health = async () => Object.fromEntries(await Promise.all([
    '/sys/fs/cgroup/cpu.stat', '/sys/fs/cgroup/cpu.pressure', '/sys/fs/cgroup/memory.events',
    '/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory.pressure'
  ].map(async path => [path, await readFile(path, 'utf8').then(value => value.slice(0, 2048)).catch(() => 'unavailable')])))
  const initialHealth = await health()
  let sampling = false
  let stopped = false
  let samplePending: Promise<void> = Promise.resolve()
  const timer = setInterval(() => {
    if (sampling || stopped) return
    sampling = true
    const started = Date.now()
    samplePending = Promise.all([processState(mainPid), processState(rendererPid)]).then(([main, renderer]) => {
      if (stopped) return
      samples.push({ started, finished: Date.now(), main, renderer })
      if (samples.length > 128) samples.shift()
    }).finally(() => { sampling = false })
  }, 250)
  return {
    async measure<T>(label: 'theme' | 'resize' | 'innerWidth', action: () => Promise<T>): Promise<T> {
      record({ label, phase: 'start', time: Date.now() })
      try {
        const result = await action()
        record({ label, phase: 'end', time: Date.now(), ...(label === 'innerWidth' && typeof result === 'number' ? { width: result } : {}) })
        return result
      } catch (error) { record({ label, phase: 'error', time: Date.now() }); throw error }
    },
    async stop(): Promise<void> {
      stopped = true
      clearInterval(timer)
      await samplePending
      const finalHealth = await health()
      // A stalled main process must not strand diagnostic teardown.
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined
      const cleanup = app.evaluate(() => {
        const state = globalThis as typeof globalThis & ProbeGlobals
        state.__continuityResizeProbe?.stop()
        delete state.__continuityResizeProbe
      }).catch(() => undefined)
      await Promise.race([cleanup, new Promise<void>(resolve => { cleanupTimer = setTimeout(resolve, 1000) })])
      clearTimeout(cleanupTimer)
      await info.attach('continuity-native', { path: nativePath, contentType: 'application/jsonl' })
      await info.attach('continuity-process', { body: JSON.stringify({ operations, samples, initialHealth, finalHealth }), contentType: 'application/json' })
    }
  }
}
