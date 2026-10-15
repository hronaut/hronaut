import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import type { ElectronApplication, TestInfo } from '@playwright/test'

export function hasContinuityResizeCapture(): boolean {
  const path = process.env.HRONAUT_CONTINUITY_RESIZE_STOP_FILE
  return process.env.HRONAUT_CONTINUITY_RESIZE_DIAGNOSTICS === 'true' && !!path && existsSync(path)
}

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
      if (count++ < 128) {
        try { appendFileSync(file, JSON.stringify({ time: Date.now(), event, dimensions }) + '\n') } catch { count = 128 }
      }
    }
    const original = window.setSize
    window.setSize = function (...args: Parameters<typeof original>) {
      mark('setSize:start', args.slice(0, 2) as number[])
      const result = original.apply(this, args)
      mark('setSize:end')
      mark('getContentSize:start')
      try { mark('getContentSize:end', this.getContentSize()) } catch { mark('getContentSize:error') }
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
  const rendererSession = await app.context().newCDPSession(await app.firstWindow())
  // Persist before teardown: worker termination must not erase already observed evidence.
  // Fixed byte budget; no open stream, unbounded queue, page data, or error messages.
  const checkpointPath = info.outputPath('continuity-checkpoint.jsonl')
  let checkpointBytes = 0
  let checkpointUnavailable = false
  const checkpoint = (kind: string, value: object) => {
    if (checkpointUnavailable) return
    const line = JSON.stringify({ kind, ...value }) + '\n'
    const bytes = Buffer.byteLength(line)
    if (checkpointBytes + bytes > 256 * 1024) return
    try { appendFileSync(checkpointPath, line); checkpointBytes += bytes } catch { checkpointUnavailable = true }
  }
  const operations: object[] = []
  const samples: object[] = []
  const record = (value: object) => { checkpoint('operation', value); operations.push(value); if (operations.length > 128) operations.shift() }
  const processState = async (pid: number, tid?: number) => {
    const directory = tid === undefined ? `/proc/${pid}` : `/proc/${pid}/task/${tid}`
    try {
      const [stat, wchan] = await Promise.all([readFile(`${directory}/stat`, 'utf8'), readFile(`${directory}/wchan`, 'utf8')])
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
  checkpoint('initialHealth', { health: initialHealth })
  let sampling = false
  let stopped = false
  let samplePending: Promise<void> = Promise.resolve()
  const timer = setInterval(() => {
    if (sampling || stopped) return
    sampling = true
    const started = Date.now()
    samplePending = Promise.all([processState(mainPid), processState(rendererPid)]).then(([main, renderer]) => {
      if (stopped) return
      const sample = { started, finished: Date.now(), main, renderer }
      checkpoint('sample', sample)
      samples.push(sample)
      if (samples.length > 128) samples.shift()
    }).finally(() => { sampling = false })
  }, 250)
  let triggered = false
  let triggeredWork: Promise<void> = Promise.resolve()
  const bounded = async (action: () => Promise<unknown>): Promise<'answered' | 'error' | 'deadline'> => {
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        Promise.resolve().then(action).then(() => 'answered' as const, () => 'error' as const),
        new Promise<'deadline'>(resolve => { deadline = setTimeout(() => resolve('deadline'), 1000) })
      ])
    } finally { clearTimeout(deadline) }
  }
  const trigger = async () => {
    if (triggered || stopped) return
    triggered = true
    const stopPath = process.env.HRONAUT_CONTINUITY_RESIZE_STOP_FILE
    if (stopPath) {
      // Claim once across workers/retries before issuing any control/thread probes.
      // Failure to claim disables only capture, never the original test or its retry.
      try { writeFileSync(stopPath, 'captured\n', { flag: 'wx' }) } catch {
        checkpoint('captureNotClaimed', { time: Date.now() })
        return
      }
    }
    checkpoint('stallTrigger', { time: Date.now() })
    const control = async (target: string, action: () => Promise<unknown>) => {
      checkpoint('control', { target, phase: 'start', time: Date.now() })
      const result = await bounded(action)
      checkpoint('control', { target, phase: result, time: Date.now() })
    }
    const threads = async () => {
      for (let index = 0; index < 3 && !stopped; index++) {
        const time = Date.now()
        const snapshot = await Promise.all([mainPid, rendererPid].map(async pid => {
          try {
            const ids = (await readdir(`/proc/${pid}/task`)).filter(id => /^\d+$/.test(id)).map(Number).sort((a, b) => a - b)
            return { truncated: ids.length > 64, threads: await Promise.all(ids.slice(0, 64).map(async tid => ({ tid, ...await processState(pid, tid) }))) }
          } catch { return { unavailable: true } }
        }))
        if (!stopped) checkpoint('threads', { time, main: snapshot[0], renderer: snapshot[1] })
        if (index < 2) await new Promise(resolve => setTimeout(resolve, 250))
      }
    }
    await Promise.all([
      control('main', () => app.evaluate(() => 1)),
      control('renderer', async () => {
        const result = await rendererSession.send('Runtime.evaluate', { expression: '1', returnByValue: true })
        if (result.result.value !== 1) throw new Error('Unexpected scalar control result')
      }),
      bounded(threads)
    ])
  }
  return {
    async measure<T>(label: 'theme' | 'resize' | 'innerWidth', action: () => Promise<T>): Promise<T> {
      record({ label, phase: 'start', time: Date.now() })
      const triggerTimer = label === 'innerWidth' ? setTimeout(() => { triggeredWork = trigger() }, 1000) : undefined
      try {
        const result = await action()
        record({ label, phase: 'end', time: Date.now(), ...(label === 'innerWidth' && typeof result === 'number' ? { width: result } : {}) })
        return result
      } catch (error) { record({ label, phase: 'error', time: Date.now() }); throw error }
      finally { clearTimeout(triggerTimer) }
    },
    async stop(): Promise<void> {
      stopped = true
      clearInterval(timer)
      await bounded(() => Promise.all([samplePending, triggeredWork]))
      const finalHealth = await health()
      checkpoint('finalHealth', { health: finalHealth })
      // A stalled main process must not strand diagnostic teardown.
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined
      const cleanup = app.evaluate(() => {
        const state = globalThis as typeof globalThis & ProbeGlobals
        state.__continuityResizeProbe?.stop()
        delete state.__continuityResizeProbe
      }).catch(() => undefined)
      await Promise.race([cleanup, new Promise<void>(resolve => { cleanupTimer = setTimeout(resolve, 1000) })])
      clearTimeout(cleanupTimer)
      await bounded(() => rendererSession.detach())
      checkpoint('cleanup', { time: Date.now() })
      // Diagnostic attachment failure must not replace the test's original failure.
      await Promise.allSettled([
        info.attach('continuity-native', { path: nativePath, contentType: 'application/jsonl' }),
        info.attach('continuity-checkpoint', { path: checkpointPath, contentType: 'application/jsonl' }),
        info.attach('continuity-process', { body: JSON.stringify({ operations, samples, initialHealth, finalHealth, checkpointUnavailable }), contentType: 'application/json' })
      ])
    }
  }
}
