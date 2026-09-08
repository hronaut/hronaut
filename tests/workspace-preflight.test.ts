import { describe, expect, it } from 'vitest'
import { workspacePreflight, type WorkspacePreflightInput } from '../src/main/mcp/workspace-preflight.js'

const input = (): WorkspacePreflightInput => ({
  authorized: true,
  tab: { url: 'https://example.test/private?token=private-canary', loading: false, sleeping: false },
  policy: { mode: 'unrestricted', rules: [] },
  expectedOrigin: 'https://example.test', paused: false, attentionRequired: false
})
const reason = (value: WorkspacePreflightInput, check: string) => workspacePreflight(value).checks.find(entry => entry.check === check)

describe('bounded workspace preflight', () => {
  it('does not equate reachable matching context with a verified session or a safe write', () => {
    const result = workspacePreflight(input())
    expect(result.status).toBe('WARN')
    expect(result.sessionEvidence).toEqual({ status: 'UNAVAILABLE', verifiedAt: null, ageMs: null })
    expect(result.writeSafety).toBe('NOT_ESTABLISHED')
    expect(result.checks.find(check => check.check === 'origin')).toMatchObject({ status: 'PASS', reason: 'ORIGIN_MATCHED' })
    expect(JSON.stringify(result)).not.toMatch(/example\.test|private-canary|token=/)
  })

  it('does not inspect any workspace data when ownership is unavailable', () => {
    const value = input()
    value.authorized = false
    Object.defineProperty(value, 'tab', { get: () => { throw new Error('Should not inspect private context') } })
    expect(workspacePreflight(value).checks).toEqual([expect.objectContaining({ status: 'BLOCKED', reason: 'WORKSPACE_UNAVAILABLE' })])
  })

  it.each(['https://user:secret@example.test', 'https://example.test/path', 'https://example.test/?secret=1', 'https://example.test/#secret', 'file:///private', 'not a URL'])(
    'rejects invalid expected origin without echoing it: %s', expectedOrigin => {
      const result = workspacePreflight({ ...input(), expectedOrigin })
      expect(result.status).toBe('BLOCKED')
      expect(result.checks).toContainEqual(expect.objectContaining({ reason: 'EXPECTED_ORIGIN_INVALID' }))
      expect(JSON.stringify(result)).not.toContain(expectedOrigin)
    }
  )

  it('warns for an origin mismatch or omitted expectation', () => {
    expect(reason({ ...input(), expectedOrigin: 'https://other.test' }, 'origin')).toMatchObject({ status: 'WARN', reason: 'ORIGIN_UNEXPECTED' })
    expect(reason({ ...input(), expectedOrigin: undefined }, 'origin')).toMatchObject({ status: 'WARN', reason: 'ORIGIN_NOT_SPECIFIED' })
  })

  it('checks the intended destination against the existing navigation policy without returning its rules', () => {
    const value = { ...input(), policy: { mode: 'restricted' as const, rules: ['https://other.test'] } }
    expect(reason(value, 'policy')).toMatchObject({ status: 'BLOCKED', reason: 'SITE_BLOCKED' })
    expect(JSON.stringify(workspacePreflight(value))).not.toContain('other.test')
  })

  it('reports missing, sleeping, and loading tabs without waking or navigating them', () => {
    expect(reason({ ...input(), tab: null }, 'tab')).toMatchObject({ status: 'BLOCKED' })
    expect(reason({ ...input(), tab: { ...input().tab!, sleeping: true } }, 'tab')).toMatchObject({ reason: 'TAB_SLEEPING' })
    expect(reason({ ...input(), tab: { ...input().tab!, loading: true } }, 'tab')).toMatchObject({ reason: 'TAB_LOADING' })
  })

  it('blocks pending human attention or pause with a fresh-state next action', () => {
    expect(reason({ ...input(), paused: true }, 'human')).toMatchObject({ status: 'BLOCKED', reason: 'USER_PAUSED' })
    expect(reason({ ...input(), attentionRequired: true }, 'human')).toMatchObject({ status: 'BLOCKED', reason: 'HUMAN_STEP_REQUIRED' })
  })
})
