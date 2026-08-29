import { spawn, type ChildProcess } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const gates = [
  { name: 'lint', arguments: ['run', 'lint'] },
  { name: 'unit/component tests', arguments: ['test'] },
  { name: 'typecheck', arguments: ['run', 'typecheck'] },
  { name: 'application build', arguments: ['run', 'build:app'] }
] as const

const children = new Set<ChildProcess>()

function terminateChildren(): void {
  for (const child of children) child.kill('SIGTERM')
}

process.once('SIGINT', terminateChildren)
process.once('SIGTERM', terminateChildren)

const results = await Promise.all(gates.map(({ name, arguments: commandArguments }) => new Promise<{
  name: string
  status: number
}>((resolve) => {
  process.stdout.write(`[static] Starting ${name}.\n`)
  const child = spawn(npmCommand, commandArguments, {
    env: process.env,
    stdio: 'inherit'
  })
  children.add(child)
  child.once('error', (error) => {
    children.delete(child)
    process.stderr.write(`[static] ${name} could not start: ${error.message}\n`)
    resolve({ name, status: 1 })
  })
  child.once('exit', (code, signal) => {
    children.delete(child)
    const status = code ?? 1
    process.stdout.write(`[static] ${name} finished with ${signal ? `signal ${signal}` : `status ${status}`}.\n`)
    resolve({ name, status })
  })
})))

const failures = results.filter(({ status }) => status !== 0)
if (failures.length > 0) {
  process.stderr.write(`[static] Failed gates: ${failures.map(({ name }) => name).join(', ')}.\n`)
  process.exitCode = 1
}
