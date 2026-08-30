import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface TypecheckProject {
  name: string
  executable: string
  config: string
}

const projects: TypecheckProject[] = [
  {
    name: 'node',
    executable: resolve('node_modules/typescript/lib/tsc.js'),
    config: 'tsconfig.node.json'
  },
  {
    name: 'web',
    executable: resolve('node_modules/vue-tsc/bin/vue-tsc.js'),
    config: 'tsconfig.web.json'
  },
  {
    name: 'website',
    executable: resolve('node_modules/typescript/lib/tsc.js'),
    config: 'tsconfig.website.json'
  }
]

export function typecheckJobCount(value = process.env.HRONAUT_TYPECHECK_JOBS): number {
  if (value === undefined || value === '') return 2
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > projects.length) {
    throw new Error(`HRONAUT_TYPECHECK_JOBS must be an integer from 1 through ${projects.length}.`)
  }
  return parsed
}

async function main(): Promise<void> {
  let concurrency: number
  try {
    concurrency = typecheckJobCount()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
    return
  }

  const children = new Set<ChildProcess>()
  let nextProject = 0
  let failed = false
  let interruptedSignal: NodeJS.Signals | undefined

  function terminateChildren(): void {
    for (const child of children) child.kill('SIGTERM')
  }

  function interrupt(signal: NodeJS.Signals): void {
    if (interruptedSignal) return
    interruptedSignal = signal
    terminateChildren()
  }

  const handleSigint = (): void => interrupt('SIGINT')
  const handleSigterm = (): void => interrupt('SIGTERM')
  process.once('SIGINT', handleSigint)
  process.once('SIGTERM', handleSigterm)

  async function worker(): Promise<void> {
    while (!interruptedSignal && nextProject < projects.length) {
      const project = projects[nextProject]
      nextProject += 1
      if (!project) return

      process.stdout.write(`[typecheck] Starting ${project.name}.\n`)
      const status = await new Promise<number>((done) => {
        const child = spawn(process.execPath, [
          project.executable,
          '--build',
          '--noEmit',
          project.config
        ], { env: process.env, stdio: 'inherit' })
        children.add(child)
        child.once('error', (error) => {
          children.delete(child)
          process.stderr.write(`[typecheck] ${project.name} could not start: ${error.message}\n`)
          done(1)
        })
        child.once('exit', (code, signal) => {
          children.delete(child)
          const exitStatus = code ?? 1
          process.stdout.write(`[typecheck] ${project.name} finished with ${signal ? `signal ${signal}` : `status ${exitStatus}`}.\n`)
          done(exitStatus)
        })
      })
      if (status !== 0) failed = true
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  process.removeListener('SIGINT', handleSigint)
  process.removeListener('SIGTERM', handleSigterm)
  if (interruptedSignal) {
    process.kill(process.pid, interruptedSignal)
    return
  }
  if (failed) process.exitCode = 1
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (entryPath === fileURLToPath(import.meta.url)) await main()
