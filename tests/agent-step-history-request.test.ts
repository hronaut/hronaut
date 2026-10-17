import { describe, expect, it } from 'vitest'
import { AGENT_STEP_HISTORY_LIMIT, isAgentStepId, parseAgentStepHistoryRequest } from '../src/shared/agent-presence.js'

const clientKey = 'AbCdEfGhIjKlMnOpQrSt-_'

describe('agent step history request', () => {
  it('takes a presence key, a workspace and the steps whose pictures the shell has', () => {
    expect(parseAgentStepHistoryRequest({ clientKey, workspaceId: 'workspace-1', known: ['s1', 's2z'] }))
      .toEqual({ clientKey, workspaceId: 'workspace-1', known: ['s1', 's2z'] })
    expect(isAgentStepId('s0')).toBe(true)
    expect(isAgentStepId('step-1')).toBe(false)
  })

  it('refuses anything else from the shell', () => {
    const valid = { clientKey, workspaceId: 'workspace-1', known: [] }
    for (const request of [
      null,
      [],
      { ...valid, clientKey: 'session-id' },
      { ...valid, clientKey: `${clientKey}x` },
      { ...valid, workspaceId: '' },
      { ...valid, workspaceId: 'w'.repeat(129) },
      { ...valid, workspaceId: 7 },
      { ...valid, known: 's1' },
      { ...valid, known: ['S1'] },
      { ...valid, known: [1] },
      { ...valid, known: Array.from({ length: AGENT_STEP_HISTORY_LIMIT + 1 }, (_value, index) => `s${index}`) }
    ]) {
      expect(() => parseAgentStepHistoryRequest(request), JSON.stringify(request)).toThrow(TypeError)
    }
  })
})
