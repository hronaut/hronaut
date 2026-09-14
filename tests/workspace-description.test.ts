import { describe, expect, it } from 'vitest'
import { MAX_WORKSPACE_DESCRIPTION_LENGTH, normalizeWorkspaceDescription } from '../src/shared/workspace-description.js'

describe('workspace descriptions', () => {
  it('normalizes line endings, Unicode, and surrounding whitespace', () => {
    expect(normalizeWorkspaceDescription('  Cafe\u0301\r\nQA  ')).toBe('Café\nQA')
    expect(normalizeWorkspaceDescription('   ')).toBe('')
  })

  it('rejects oversized descriptions and unsafe control characters', () => {
    expect(() => normalizeWorkspaceDescription('x'.repeat(MAX_WORKSPACE_DESCRIPTION_LENGTH + 1))).toThrow('1000')
    expect(() => normalizeWorkspaceDescription('purpose\u0000context')).toThrow('control')
  })
})
