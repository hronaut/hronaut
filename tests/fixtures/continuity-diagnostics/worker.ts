import { continuityResizeDiagnostics } from '../../integration/continuity-resize-diagnostics.ts'
import type { ElectronApplication, TestInfo } from '@playwright/test'
import { join } from 'node:path'

const never = () => new Promise<never>(() => {})
let calls = 0
const app = {
  evaluate: () => ++calls === 1 ? Promise.resolve(process.pid) : never(),
  process: () => ({ pid: process.pid }),
  firstWindow: async () => ({}),
  context: () => ({ newCDPSession: async () => ({ send: never, detach: async () => {} }) })
} as unknown as ElectronApplication
const info = { outputPath: (name: string) => join(process.argv[2]!, name), attach: async () => {} } as unknown as TestInfo
const probe = await continuityResizeDiagnostics(app, info)
void probe!.measure('innerWidth', never)
process.stdout.write('ready\n')
