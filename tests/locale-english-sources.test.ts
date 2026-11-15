import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { enUS } from '../src/shared/locales/en-US.js'

/**
 * Every language is translated from the English text. english-sources.json keeps a short hash of the English text
 * each key was last translated from, so changing an English string without translating it again fails here.
 * After translating the changed keys into every language, record them with `npm run locales:mark-translated`.
 */
const SOURCES = new URL('../src/shared/locales/english-sources.json', import.meta.url)

function englishLeaves(value: unknown, prefix = '', leaves: Record<string, string> = {}): Record<string, string> {
  if (typeof value === 'string') leaves[prefix] = createHash('sha256').update(value).digest('hex').slice(0, 10)
  else if (Array.isArray(value)) value.forEach((item, index) => englishLeaves(item, `${prefix}[${index}]`, leaves))
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) englishLeaves(item, prefix ? `${prefix}.${key}` : key, leaves)
  }
  return leaves
}

describe('English sources of translations', () => {
  it('has every English string translated from its current text', () => {
    const current = englishLeaves(enUS)
    if (process.env.HRONAUT_MARK_TRANSLATED === '1') {
      writeFileSync(SOURCES, `${JSON.stringify(current, null, 2)}\n`)
    }
    const recorded = JSON.parse(readFileSync(SOURCES, 'utf8')) as Record<string, string>
    const changed = Object.keys(current).filter((key) => key in recorded && recorded[key] !== current[key])
    const added = Object.keys(current).filter((key) => !(key in recorded))
    const removed = Object.keys(recorded).filter((key) => !(key in current))
    expect({ changed, added, removed }, [
      'English text changed since its translations were last made. Translate these keys again in every language',
      'under src/shared/locales/, then run `npm run locales:mark-translated`.'
    ].join(' ')).toEqual({ changed: [], added: [], removed: [] })
  })
})
