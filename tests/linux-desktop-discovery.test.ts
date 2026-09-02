import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface ElectronBuilderConfig {
  linux?: {
    category?: string
    description?: string
    desktop?: {
      entry?: Record<string, unknown>
    }
  }
}

describe('Linux desktop discovery metadata', () => {
  it('exposes factual, privacy-safe launcher search terms', async () => {
    const source = await readFile('electron-builder.yml', 'utf8')
    const config = parse(source) as ElectronBuilderConfig
    const entry = config.linux?.desktop?.entry ?? {}

    expect(config.linux?.category).toBe('Network')
    expect(entry.GenericName).toBe('Browser MCP')
    expect(config.linux?.description).toBe('Visible, persistent browser for coding agents')
    expect(entry.Comment).toBeUndefined()

    const keywords = entry.Keywords
    expect(keywords).toBeTypeOf('string')
    expect(keywords).toMatch(/^(?:[^;\r\n]+;)+$/u)
    const searchTerms = (keywords as string).split(';').filter(Boolean)
    expect(new Set(searchTerms).size).toBe(searchTerms.length)
    expect(searchTerms).toEqual(expect.arrayContaining([
      'browser',
      'MCP',
      'AI',
      'coding agent',
      'automation',
      'QA',
      'testing'
    ]))

    expect(`${String(entry.GenericName)} ${String(config.linux?.description)} ${String(keywords)}`)
      .not.toMatch(/https?:|localhost|127\.0\.0\.1|credential|secret|token/iu)
  })
})
