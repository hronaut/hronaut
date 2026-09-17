import { describe, expect, it } from 'vitest'
import {
  applyClientVisibleToolEvidence,
  buildMcpReadinessDiagnostic,
  type McpReadinessInput
} from '../src/main/mcp/readiness.js'

const ready: McpReadinessInput = {
  checkedAt: '2026-09-17T10:00:00.000Z',
  serverStatus: 'ready',
  startedAt: '2026-09-17T09:00:00.000Z',
  advertisedToolNames: ['browser_status', 'browser_snapshot', 'browser_navigate'],
  clients: []
}

describe('MCP readiness diagnostics', () => {
  it('keeps listener health separate from missing client attachment', () => {
    const report = buildMcpReadinessDiagnostic(ready)

    expect(report.checks.app.state).toBe('app_ready')
    expect(report.checks.endpoint.state).toBe('endpoint_ready')
    expect(report.checks.advertisedTools).toMatchObject({ state: 'tools_advertised', evidence: { toolCount: 3 } })
    expect(report.checks.initialization.state).toBe('blocked')
    expect(report.checks.configuration.state).toBe('unknown')
    expect(report.checks.clientVisibility.state).toBe('client_visibility_unknown')
    expect(report.checks.probe.state).toBe('blocked')
  })

  it('keeps the app and endpoint ready while agents are paused', () => {
    const report = buildMcpReadinessDiagnostic({ ...ready, serverStatus: 'paused' })

    expect(report.checks.app.state).toBe('app_ready')
    expect(report.checks.endpoint.state).toBe('endpoint_ready')
    expect(report.checks.initialization.state).toBe('blocked')
  })

  it('reports delayed initialization without treating an in-flight request as attachment', () => {
    const report = buildMcpReadinessDiagnostic({
      ...ready,
      clients: [{
        id: 'raw-session-id',
        name: 'Private custom agent name',
        version: '1.0.0',
        lastSeenAt: '2026-09-17T09:59:59.000Z',
        requestCount: 1,
        activeRequests: 1
      }]
    })

    expect(report.checks.initialization.state).toBe('unknown')
    expect(report.checks.clientVisibility.state).toBe('client_visibility_unknown')
    expect(JSON.stringify(report)).not.toContain('raw-session-id')
    expect(JSON.stringify(report)).not.toContain('Private custom agent name')
  })

  it('does not equate initialize or tools/list with active-client tool visibility', () => {
    const report = buildMcpReadinessDiagnostic({
      ...ready,
      clients: [{
        id: 'session-1', name: 'direct-probe', lastSeenAt: '2026-09-17T09:59:59.000Z',
        requestCount: 2, activeRequests: 0,
        initializedAt: '2026-09-17T09:59:58.000Z',
        toolsListedAt: '2026-09-17T09:59:59.000Z'
      }]
    })

    expect(report.checks.initialization.state).toBe('client_initialized')
    expect(report.checks.clientVisibility.state).toBe('client_visibility_unknown')
    expect(report.checks.clientVisibility.state).not.toBe('client_tools_verified')
    expect(report.checks.probe.state).toBe('unknown')
  })

  it('detects partial manually observed tool inventories and verifies only complete matches', () => {
    const base = buildMcpReadinessDiagnostic(ready)
    const partial = applyClientVisibleToolEvidence(base, ready.advertisedToolNames, [
      'browser_status', 'browser_snapshot', 'other_server_tool'
    ])
    expect(partial.checks.clientVisibility).toMatchObject({
      state: 'partial_tool_inventory',
      evidence: { observedToolCount: 2, missingToolCount: 1, missingTools: ['browser_navigate'] }
    })

    const complete = applyClientVisibleToolEvidence(base, ready.advertisedToolNames, [
      'browser_navigate', 'browser_snapshot', 'browser_status'
    ])
    expect(complete.checks.clientVisibility).toMatchObject({
      state: 'client_tools_verified',
      evidence: { observedToolCount: 3, missingToolCount: 0 }
    })
  })

  it('separates failed and successful benign probes for the most recent initialized session', () => {
    const client = {
      id: 'session-1', name: 'agent', lastSeenAt: '2026-09-17T09:59:59.000Z',
      requestCount: 3, activeRequests: 0,
      initializedAt: '2026-09-17T09:59:50.000Z'
    }
    const failed = buildMcpReadinessDiagnostic({
      ...ready,
      clients: [{ ...client, readinessProbe: { toolName: 'browser_status', outcome: 'failed', completedAt: '2026-09-17T09:59:59.000Z' } }]
    })
    expect(failed.checks.probe).toMatchObject({ state: 'probe_failed', evidence: { toolName: 'browser_status' } })

    const verified = buildMcpReadinessDiagnostic({
      ...ready,
      clients: [{ ...client, readinessProbe: { toolName: 'browser_snapshot', outcome: 'verified', completedAt: '2026-09-17T09:59:59.000Z' } }]
    })
    expect(verified.checks.probe).toMatchObject({ state: 'probe_verified', evidence: { toolName: 'browser_snapshot' } })
  })

  it('bounds missing-tool evidence and never copies raw server errors', () => {
    const advertisedToolNames = Array.from({ length: 30 }, (_, index) => `browser_fixture_${index}`)
    const report = applyClientVisibleToolEvidence(buildMcpReadinessDiagnostic({
      ...ready,
      serverStatus: 'error',
      serverError: 'Bearer secret-token failed at /private/account',
      advertisedToolNames
    }), advertisedToolNames, [])

    expect(report.checks.app.state).toBe('blocked')
    expect(report.checks.clientVisibility.evidence?.missingTools).toHaveLength(12)
    expect(report.checks.clientVisibility.evidence?.missingToolCount).toBe(30)
    const copied = JSON.stringify(report)
    expect(copied).not.toContain('secret-token')
    expect(copied).not.toContain('/private/account')
  })
})
