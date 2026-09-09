import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

for (const cleanupFails of [false, true]) {
  test(`reports workspace creation failure with cleanup ${cleanupFails ? 'retained' : 'completed'}`, async ({ appWindow, electronApp }) => {
    const before = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    await electronApp.evaluate(({ WebContentsView }, failCleanup) => {
      const originalBounds = WebContentsView.prototype.setBounds
      WebContentsView.prototype.setBounds = function (bounds) {
        if (!this.webContents.getURL()) {
          WebContentsView.prototype.setBounds = originalBounds
          if (failCleanup) {
            const browserSession = this.webContents.session
            const originalClear = browserSession.clearData.bind(browserSession)
            browserSession.clearData = async (..._args: Parameters<Electron.Session['clearData']>) => {
              browserSession.clearData = originalClear
              throw new Error('simulated creation cleanup failure')
            }
          }
          throw new Error('simulated initial workspace tab failure')
        }
        return originalBounds.call(this, bounds)
      }
    }, cleanupFails)
    const error = await appWindow.evaluate(async () => {
      try {
        await (window as unknown as { hronaut: HronautApi }).hronaut.createWorkspace({ name: 'Creation recovery', storage: 'scratch' })
        return 'unexpected success'
      } catch (error) {
        return String(error)
      }
    })
    const after = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    const retained = after.mcpTabGroups.find(group => group.name === 'Creation recovery')
    for (const existing of before.mcpTabGroups) expect(after.mcpTabGroups).toContainEqual(existing)
    if (cleanupFails) {
      expect(retained).toBeDefined()
      expect(error).toContain('could not be created or cleaned up')
      expect(error).toContain(retained!.id)
      expect(error).toContain('remains listed')
      await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeWorkspace(id), retained!.id)
      const recovered = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
      expect(recovered.mcpTabGroups.some(group => group.id === retained!.id)).toBe(false)
    } else {
      expect(retained).toBeUndefined()
      expect(error).toContain('simulated initial workspace tab failure')
    }
  })
}
