import { spawn } from 'node:child_process'

/** One native desktop per worker: focus, clipboard and real X11 input stay isolated. */
export async function startWorkerDisplay(): Promise<{ display: string; close(): Promise<void> }> {
  const child = spawn('Xvfb', [
    '-displayfd', '1', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp', '-ac'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-2_000) })
  let exited = false
  const exit = new Promise<void>(resolve => {
    const finish = (): void => { exited = true; resolve() }
    child.once('exit', finish)
    child.once('error', finish)
  })
  // Playwright normally tears worker fixtures down; also cover abrupt worker exit.
  const killOnExit = (): void => { if (!exited) child.kill('SIGKILL') }
  process.once('exit', killOnExit)
  let closing: Promise<void> | undefined
  function close(): Promise<void> {
    closing ??= (async () => {
      try {
        if (exited) return
        child.kill('SIGTERM')
        const timer = setTimeout(killOnExit, 2_000)
        try { await exit } finally { clearTimeout(timer) }
      } finally {
        process.off('exit', killOnExit)
      }
    })()
    return closing
  }
  try {
    const display = await new Promise<string>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => finish(new Error(`Xvfb did not become ready: ${stderr}`)), 10_000)
      const onError = (error: Error): void => finish(error)
      const onExit = (): void => finish(new Error(`Xvfb exited before becoming ready: ${stderr}`))
      const onData = (chunk: Buffer): void => {
        output += String(chunk)
        if (!output.includes('\n')) return
        const number = output.trim()
        if (!/^\d+$/.test(number)) finish(new Error(`Invalid Xvfb display: ${number.slice(0, 100)}`))
        else finish(undefined, `:${number}`)
      }
      function finish(error?: Error, value?: string): void {
        clearTimeout(timer)
        child.off('error', onError)
        child.off('exit', onExit)
        child.stdout.off('data', onData)
        if (error) reject(error)
        else resolve(value!)
      }
      child.once('error', onError)
      child.once('exit', onExit)
      child.stdout.on('data', onData)
    })
    return { display, close }
  } catch (error) {
    await close()
    throw error
  }
}
