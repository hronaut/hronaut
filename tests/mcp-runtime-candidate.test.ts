import { describe, expect, it, vi } from 'vitest'
import {
  stageMcpRuntimeCandidate,
  synchronizeMcpRuntimeCandidate,
  type MutableMcpRuntimeCandidate
} from '../src/main/mcp-runtime-candidate.js'

function candidateFixture() {
  const candidate = {
    setPaused: vi.fn<(paused: boolean) => void>(),
    setAuthenticationToken: vi.fn<(token: string | undefined) => void>()
  } satisfies MutableMcpRuntimeCandidate
  return candidate
}

describe('MCP replacement runtime candidates', () => {
  it('keeps a replacement port paused while its listener and settings are staging', () => {
    const candidate = candidateFixture()

    stageMcpRuntimeCandidate(candidate)

    expect(candidate.setPaused).toHaveBeenCalledWith(true)
  })

  it('applies a newer user pause and authentication policy at port cutover', () => {
    const candidate = candidateFixture()
    const cutoverState = {
      paused: false,
      authenticationToken: 'initial-profile-token' as string | undefined
    }

    stageMcpRuntimeCandidate(candidate)
    cutoverState.paused = true
    cutoverState.authenticationToken = 'latest-profile-token'
    candidate.setPaused.mockClear()
    candidate.setAuthenticationToken.mockClear()

    synchronizeMcpRuntimeCandidate(candidate, () => cutoverState)

    expect(candidate.setPaused).toHaveBeenCalledWith(true)
    expect(candidate.setAuthenticationToken).toHaveBeenCalledWith('latest-profile-token')
    expect(candidate.setAuthenticationToken.mock.invocationCallOrder[0]!)
      .toBeLessThan(candidate.setPaused.mock.invocationCallOrder[0]!)
  })

  it('preserves a temporary pause while disabling authentication at reset cutover', () => {
    const candidate = candidateFixture()
    const cutoverState = {
      paused: false,
      authenticationToken: 'initial-profile-token' as string | undefined
    }

    stageMcpRuntimeCandidate(candidate)
    cutoverState.paused = true
    cutoverState.authenticationToken = undefined
    candidate.setPaused.mockClear()
    candidate.setAuthenticationToken.mockClear()

    synchronizeMcpRuntimeCandidate(candidate, () => cutoverState)

    expect(candidate.setPaused).toHaveBeenCalledWith(true)
    expect(candidate.setAuthenticationToken).toHaveBeenCalledWith(undefined)
  })
})
