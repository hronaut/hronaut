import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectOrder = ['typecheck:node', 'typecheck:web', 'typecheck:website'] as const

export type FocusedTypecheckScript = typeof projectOrder[number]

const websiteSharedFiles = new Set([
  'src/shared/release-assets.ts',
  'src/shared/web-clipboard.ts'
])

function normalizedPath(file: string): string {
  return file.replaceAll('\\', '/').replace(/^\.\//u, '')
}

export function typecheckScriptsForFiles(files: string[]): FocusedTypecheckScript[] {
  const projects = new Set<FocusedTypecheckScript>()

  for (const rawFile of files) {
    const file = normalizedPath(rawFile)
    if (file === 'tsconfig.web.json') {
      projects.add('typecheck:web')
    } else if (file === 'tsconfig.node.json') {
      projects.add('typecheck:node')
    } else if (file === 'tsconfig.website.json') {
      projects.add('typecheck:website')
    } else if (file === 'tsconfig.json') {
      projects.add('typecheck:node')
      projects.add('typecheck:web')
    } else if (file.startsWith('src/renderer/') || file.startsWith('tests/renderer/')) {
      projects.add('typecheck:web')
    } else if (file.startsWith('website/')) {
      projects.add('typecheck:website')
    } else if (file.startsWith('src/shared/')) {
      projects.add('typecheck:node')
      projects.add('typecheck:web')
      if (websiteSharedFiles.has(file)) projects.add('typecheck:website')
    } else if (file === 'src/preload/index.d.ts') {
      projects.add('typecheck:node')
      projects.add('typecheck:web')
    } else if (
      file.startsWith('src/main/') ||
      file.startsWith('src/preload/') ||
      file.startsWith('scripts/') ||
      file.startsWith('tests/') ||
      file.endsWith('.config.ts')
    ) {
      projects.add('typecheck:node')
    } else {
      for (const project of projectOrder) projects.add(project)
    }
  }

  return projectOrder.filter((project) => projects.has(project))
}

export function npmChildProcessInvocation(
  npmExecPath: string,
  commandArguments: string[]
): { command: string, arguments: string[] } {
  if (!npmExecPath.trim()) throw new Error('npm_execpath is required')
  return {
    command: process.execPath,
    arguments: [npmExecPath, ...commandArguments]
  }
}

async function main(): Promise<void> {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('Usage: npm run validate:focused -- <source-or-test-file> [...]')
    process.exitCode = 2
    return
  }
  if (files.some((file) => file.startsWith('-'))) {
    console.error('validate:focused accepts file paths, not command options')
    process.exitCode = 2
    return
  }

  const npmExecPath = process.env.npm_execpath
  if (!npmExecPath) {
    console.error('validate:focused must be started through npm run validate:focused')
    process.exitCode = 2
    return
  }
  const gates = [
    { name: 'focused lint', arguments: ['run', 'lint:focused', '--', ...files] },
    ...typecheckScriptsForFiles(files).map((script) => ({
      name: script,
      arguments: ['run', script]
    }))
  ]
  const children = new Set<ChildProcess>()

  function terminateChildren(): void {
    for (const child of children) child.kill('SIGTERM')
  }

  process.once('SIGINT', terminateChildren)
  process.once('SIGTERM', terminateChildren)

  const results = await Promise.all(gates.map(({ name, arguments: commandArguments }) => new Promise<{
    name: string
    status: number
  }>((done) => {
    process.stdout.write(`[focused-static] Starting ${name}.\n`)
    const invocation = npmChildProcessInvocation(npmExecPath, commandArguments)
    const child = spawn(invocation.command, invocation.arguments, {
      env: process.env,
      stdio: 'inherit'
    })
    children.add(child)
    child.once('error', (error) => {
      children.delete(child)
      process.stderr.write(`[focused-static] ${name} could not start: ${error.message}\n`)
      done({ name, status: 1 })
    })
    child.once('exit', (code, signal) => {
      children.delete(child)
      const status = code ?? 1
      process.stdout.write(`[focused-static] ${name} finished with ${signal ? `signal ${signal}` : `status ${status}`}.\n`)
      done({ name, status })
    })
  })))

  const failures = results.filter(({ status }) => status !== 0)
  if (failures.length > 0) {
    process.stderr.write(`[focused-static] Failed gates: ${failures.map(({ name }) => name).join(', ')}.\n`)
    process.exitCode = 1
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (entryPath === fileURLToPath(import.meta.url)) await main()
