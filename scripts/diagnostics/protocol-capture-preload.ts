import { createRequire } from 'node:module'
import { join } from 'node:path'
import { recordStartup, startupReason } from './protocol-capture-startup.ts'

recordStartup(1, 1)
try {
  const resolved = createRequire(import.meta.url).resolve('playwright-core/package.json')
  const matched = resolved === join(process.cwd(), 'node_modules/playwright-core/package.json')
  recordStartup(1, matched ? 2 : 3, matched ? 0 : 10)
} catch (error) { recordStartup(1, 3, startupReason(error)) }
recordStartup(2, 1)
process.on('uncaughtExceptionMonitor', error => recordStartup(2, 3, startupReason(error)))
process.once('exit', code => recordStartup(10, 4, 0, code))
