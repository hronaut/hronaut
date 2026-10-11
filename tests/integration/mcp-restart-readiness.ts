import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import type { HronautApi, HronautMcpApi } from '../../src/shared/types.js'
import type { HronautInstance } from './fixtures.js'
import { expect } from './fixtures.js'

export async function waitForRestartMcp(
  previousProcess: ReturnType<ElectronApplication['process']>,
  restarted: HronautInstance,
  port: number,
  timeout = 8_000
): Promise<void> {
  expect(previousProcess.exitCode !== null || previousProcess.signalCode !== null, 'Previous Hronaut process must exit before restart readiness').toBe(true)
  const child = restarted.app.process()
  expect(child.pid).not.toBe(previousProcess.pid)
  expect(await restarted.app.evaluate(() => process.pid)).toBe(child.pid)
  const endpoint = `http://127.0.0.1:${port}/mcp`
  await expect.poll(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return false
    // A health response alone could come from an unrelated listener. The
    // restarted process must first confirm its own successful bind and endpoint.
    const owner = await restarted.window.evaluate(async () => {
      const { hronaut, hronautMcp } = window as unknown as { hronaut: HronautApi; hronautMcp: HronautMcpApi }
      const [browser, mcp] = await Promise.all([hronaut.getState(), hronautMcp.getState()])
      return { endpoint: browser.mcpUrl, status: mcp.status }
    })
    if (owner.endpoint !== endpoint || owner.status !== 'ready') return false
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      redirect: 'error', signal: AbortSignal.timeout(Math.min(timeout, 1_000))
    }).catch(() => null)
    if (!response?.ok) return false
    const health = await response.json().catch(() => null) as { ok?: unknown; name?: unknown } | null
    return health?.ok === true && health.name === 'hronaut' && child.exitCode === null && child.signalCode === null
  }, { message: 'Restarted MCP listener must become ready', timeout, intervals: [100] }).toBe(true)
}

export type RestartGlobal = typeof globalThis & { __releaseRestartMcpListener?: () => void; __restartMcpListener?: { listening: boolean } }

export async function holdRestartListener(directory: string): Promise<string> {
  const hook = join(directory, 'hold-restart-listener.cjs')
  await writeFile(hook, `
    const { Server } = require('node:http');
    const original = Server.prototype.listen;
    Server.prototype.listen = function (...args) {
      const port = typeof args[0] === 'object' ? args[0].port : args[0];
      if (Number(port) !== Number(process.env.HRONAUT_MCP_PORT)) return original.apply(this, args);
      Server.prototype.listen = original;
      globalThis.__restartMcpListener = this;
      globalThis.__releaseRestartMcpListener = () => { delete globalThis.__releaseRestartMcpListener; original.apply(this, args); };
      return this;
    };
  `)
  return hook
}
