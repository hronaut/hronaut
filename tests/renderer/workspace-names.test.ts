import { describe, expect, it, vi } from 'vitest'
import { suggestWorkspaceName } from '../../src/renderer/src/workspace-names.js'

describe('workspace name suggestions', () => {
  it('produces a readable two-word label with no existing names', () => {
    expect(suggestWorkspaceName([], () => 0)).toBe('Curious Otter')
    expect(suggestWorkspaceName([], () => 0.999)).toBe('Lucky Capybara')
  })

  it('retries a collision without changing an existing name', () => {
    const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(0.999)
    const existing = ['Curious Otter']
    expect(suggestWorkspaceName(existing, random)).toBe('Lucky Capybara')
    expect(existing).toEqual(['Curious Otter'])
  })

  it('bounds random retries and skips normalized duplicate suffixes', () => {
    const random = vi.fn(() => 0)
    expect(suggestWorkspaceName([' curious OTTER ', 'Curious Otter 2', 'CURIOUS OTTER 3', 'Curious Otter 5'], random)).toBe('Curious Otter 4')
    expect(random).toHaveBeenCalledTimes(16)
  })
})
