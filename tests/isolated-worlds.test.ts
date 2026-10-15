import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ISOLATED_WORLDS, MAX_ISOLATED_WORLD_ID, RESERVED_WORLD_IDS } from '../src/main/browser/isolated-worlds.js'

const root = join(import.meta.dirname, '..')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|vue)$/.test(entry.name) ? [path] : []
  })
}

describe('isolated world registry', () => {
  it('gives every feature its own valid world', () => {
    const ids = Object.values(ISOLATED_WORLDS)
    expect(new Set(ids).size).toBe(ids.length)
    for (const [name, id] of Object.entries(ISOLATED_WORLDS)) {
      expect(Number.isInteger(id), name).toBe(true)
      expect(id, name).toBeGreaterThan(0)
      expect(id, name).toBeLessThanOrEqual(MAX_ISOLATED_WORLD_ID)
      expect(RESERVED_WORLD_IDS, name).not.toContain(id)
    }
  })

  it('keeps world numbers out of the owning modules', () => {
    const handNumbered = sourceFiles(join(root, 'src'))
      .filter(path => !path.endsWith(join('browser', 'isolated-worlds.ts')))
      .flatMap(path => readFileSync(path, 'utf8').split('\n').flatMap((line, index) => (
        /WORLD_ID\s*=\s*\d|IsolatedWorld\(\s*\d|worldId:\s*\d/.test(line) ? [`${relative(root, path)}:${index + 1}`] : []
      )))
    expect(handNumbered).toEqual([])
  })
})
