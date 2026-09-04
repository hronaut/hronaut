import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('renderer UI component boundary', () => {
  it('routes every application action button through UiButton', () => {
    const rendererDirectory = new URL('../src/renderer/src/', import.meta.url)
    const rawButtonSources = readdirSync(rendererDirectory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.vue'))
      .filter((entry) => entry.name !== 'UiButton.vue')
      .map((entry) => ({
        filename: `${entry.parentPath}/${entry.name}`,
        source: readFileSync(`${entry.parentPath}/${entry.name}`, 'utf8')
      }))
      .filter(({ source }) => /<button(?:\s|>)/u.test(source))
      .map(({ filename }) => filename)

    expect(rawButtonSources).toEqual([])
  })

  it('does not bypass the shared button contract', () => {
    const rendererDirectory = new URL('../src/renderer/src/', import.meta.url)
    const nativeModeSources = readdirSync(rendererDirectory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.vue'))
      .map((entry) => ({
        filename: `${entry.parentPath}/${entry.name}`,
        source: readFileSync(`${entry.parentPath}/${entry.name}`, 'utf8')
      }))
      .filter(({ source }) => /<UiButton\b[^>]*\bnative(?:\s|>|=)/u.test(source))
      .map(({ filename }) => filename)

    expect(nativeModeSources).toEqual([])
  })
})
