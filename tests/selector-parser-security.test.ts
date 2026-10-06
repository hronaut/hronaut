import selectorParser from 'postcss-selector-parser'
import { describe, expect, it, vi } from 'vitest'

describe('selector parser security compatibility', () => {
  // GHSA-rj75-hqrm-r3gf: count potential array-search work instead of timing
  // a large CPU-exhaustion payload. Even the vulnerable parser gets < 1 KiB.
  it.each(['.a', '#a', '.a#b', '.a#{b}'])(
    'keeps flat %s selector membership searches bounded', fragment => {
      const selector = fragment.repeat(128)
      const originalIndexOf = Array.prototype.indexOf
      let searchedEntries = 0
      let serialized: string
      const search = vi.spyOn(Array.prototype, 'indexOf').mockImplementation(function (
        this: unknown[], value: unknown, fromIndex?: number
      ) {
        searchedEntries += this.length
        return originalIndexOf.call(this, value, fromIndex)
      })
      try {
        serialized = selectorParser().processSync(selector)
      } finally {
        search.mockRestore()
      }
      expect(serialized).toBe(selector)
      expect(searchedEntries).toBeLessThanOrEqual(selector.length * 8)
    }
  )

  it('preserves ordinary selector serialization, decoded values and node order', () => {
    const selector = 'main > .card\\:active#result[data-kind="a.b"]:not(.hidden), svg|a::before'
    const root = selectorParser().astSync(selector)
    expect(root.toString()).toBe(selector)
    expect(root.nodes).toHaveLength(2)
    expect(root.nodes[0]!.nodes.map(node => node.type)).toEqual([
      'tag', 'combinator', 'class', 'id', 'attribute', 'pseudo'
    ])
    const classes: string[] = []
    root.walkClasses(node => { classes.push(node.value) })
    expect(classes).toEqual(['card:active', 'hidden'])
    expect(root.nodes[1]!.nodes[0]).toMatchObject({ type: 'tag', namespace: 'svg', value: 'a' })
  })
})
