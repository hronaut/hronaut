import type { ElectronApplication } from '@playwright/test'

/** How many times a read of Home's status is made before the test fails, and how long each waits for its answer. */
const READS = 3
const READ_LIMIT_MS = 2_000

/**
 * Home's status as main serves it, read through Home's own trusted session, so it does not depend on Home's renderer.
 * Main answers at once, from memory. A read with no answer after 2 s is made again: one read that never settles once
 * held a poll until its timeout, and `expect.poll` fails at once, without polling again, when its callback throws.
 */
export async function homeStatus<Status>(app: ElectronApplication): Promise<Status> {
  return await app.evaluate(async ({ webContents }, { reads, limitMs }) => {
    const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    let failure: unknown
    for (let read = 0; read < reads; read += 1) {
      try {
        const response = await home.session.fetch('hronaut://home/api/status', { signal: AbortSignal.timeout(limitMs) })
        if (!response.ok) throw new Error(`Home status read failed: ${response.status}`)
        return await response.json() as unknown
      } catch (error) {
        failure = error
      }
    }
    throw failure
  }, { reads: READS, limitMs: READ_LIMIT_MS }) as Status
}
