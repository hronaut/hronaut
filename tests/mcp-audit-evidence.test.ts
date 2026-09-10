import { describe, expect, it } from 'vitest'
import { McpActionTracker } from '../src/main/mcp/action-tracker.js'
import { auditEvidenceExpiredReason } from '../src/main/mcp/server.js'

describe('audit evidence freshness', () => {
  it('expires a retained live reference when the main process restarts even if tab generations collide', () => {
    const previousRuntime = new McpActionTracker()
    const restartedRuntime = new McpActionTracker()
    const state = {
      runtimeId: previousRuntime.runtimeId,
      controlRevision: 0,
      navigationGeneration: 1,
      observationGeneration: 0
    }
    const restoredTab = { navigationGeneration: 1, observationGeneration: 0 }

    expect(auditEvidenceExpiredReason(state, restoredTab, previousRuntime)).toBeUndefined()
    expect(auditEvidenceExpiredReason(state, restoredTab, restartedRuntime)).toBe('runtime-changed')
  })

  it('expires pre-runtime references instead of treating missing epoch data as current', () => {
    expect(auditEvidenceExpiredReason(
      { controlRevision: 0, navigationGeneration: 1, observationGeneration: 0 },
      { navigationGeneration: 1, observationGeneration: 0 },
      new McpActionTracker()
    )).toBe('runtime-changed')
  })
})
