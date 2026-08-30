import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { typecheckJobCount } from '../scripts/run-typecheck-projects.js'

describe('parallel typecheck runner', () => {
  it('uses a conservative default and accepts explicit project concurrency', () => {
    expect(typecheckJobCount(undefined)).toBe(2)
    expect(typecheckJobCount('')).toBe(2)
    expect(typecheckJobCount('1')).toBe(1)
    expect(typecheckJobCount('3')).toBe(3)
  })

  it('rejects partial, fractional, and out-of-range values', () => {
    for (const value of ['2x', '2.5', '0', '4', '-1']) {
      expect(() => typecheckJobCount(value)).toThrow(
        'HRONAUT_TYPECHECK_JOBS must be an integer from 1 through 3.'
      )
    }
  })

  it.skipIf(process.platform === 'win32')('stops scheduling projects and preserves SIGTERM semantics', async () => {
    const child = spawn(process.execPath, ['scripts/run-typecheck-projects.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, HRONAUT_TYPECHECK_JOBS: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    let signalSent = false
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      if (!signalSent && output.includes('[typecheck] Starting node.')) {
        signalSent = true
        child.kill('SIGTERM')
      }
    })

    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`Typecheck runner did not terminate after SIGTERM. Output:\n${output}`))
      }, 5_000)
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        clearTimeout(timeout)
        resolve({ code, signal })
      })
    })

    expect(signalSent).toBe(true)
    expect(result).toEqual({ code: null, signal: 'SIGTERM' })
    expect(output).not.toContain('[typecheck] Starting web.')
    expect(output).not.toContain('[typecheck] Starting website.')
  })
})
