import { describe, expect, it } from 'vitest'
import { RAIL_WORKSPACE_LIMIT, foldRailWorkspaces } from '../src/shared/workspace-rail.js'

const workspaces = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `w${index + 1}` }))
const ids = (list: Array<{ id: string }>) => list.map((workspace) => workspace.id)

describe('foldRailWorkspaces', () => {
  it('lists every workspace up to the limit, and one more, since folding one would only swap it for the row', () => {
    expect(RAIL_WORKSPACE_LIMIT).toBe(10)
    for (const count of [0, 1, 10, 11]) {
      const result = foldRailWorkspaces(workspaces(count), new Set())
      expect(ids(result.listed)).toEqual(ids(workspaces(count)))
      expect(result.folded).toEqual([])
    }
  })

  it('folds the workspaces past the first ten, in their order', () => {
    const result = foldRailWorkspaces(workspaces(14), new Set())
    expect(ids(result.listed)).toEqual(ids(workspaces(10)))
    expect(ids(result.folded)).toEqual(['w11', 'w12', 'w13', 'w14'])
  })

  it('keeps the workspaces it is asked to keep listed in their place in the order', () => {
    const result = foldRailWorkspaces(workspaces(14), new Set(['w13', 'w3', 'w11']))
    expect(ids(result.listed)).toEqual([...ids(workspaces(10)), 'w11', 'w13'])
    expect(ids(result.folded)).toEqual(['w12', 'w14'])
  })

  it('lists them all when keeping leaves only one to fold', () => {
    const result = foldRailWorkspaces(workspaces(12), new Set(['w12']))
    expect(ids(result.listed)).toEqual(ids(workspaces(12)))
    expect(result.folded).toEqual([])
  })

  it('takes another limit', () => {
    const result = foldRailWorkspaces(workspaces(5), new Set(['w5']), 2)
    expect(ids(result.listed)).toEqual(['w1', 'w2', 'w5'])
    expect(ids(result.folded)).toEqual(['w3', 'w4'])
  })
})
