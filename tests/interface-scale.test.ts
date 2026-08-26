import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTERFACE_SCALE,
  INTERFACE_SCALE_OPTIONS,
  isInterfaceScale,
  scaleShellMetric
} from '../src/shared/interface-scale.js'

describe('interface scale', () => {
  it('defaults fresh and reset profiles to 100% with bounded larger choices', () => {
    expect(DEFAULT_INTERFACE_SCALE).toBe(1)
    expect(INTERFACE_SCALE_OPTIONS.map((option) => option.value)).toEqual([1, 1.1, 1.25])
    expect(INTERFACE_SCALE_OPTIONS.every((option) => isInterfaceScale(option.value))).toBe(true)
  })

  it('maps CSS shell geometry to Electron content coordinates', () => {
    expect(scaleShellMetric(105, 1)).toBe(105)
    expect(scaleShellMetric(105, 1.1)).toBe(116)
    expect(scaleShellMetric(320, 1.25)).toBe(400)
  })

  it('rejects unsafe geometry inputs', () => {
    expect(scaleShellMetric(Number.NaN, 1.1)).toBe(0)
    expect(scaleShellMetric(-10, 1.1)).toBe(0)
    expect(scaleShellMetric(105, 0)).toBe(0)
  })

  it('keeps application text at readable compact-label sizes', () => {
    const rendererDirectory = new URL('../src/renderer/src/', import.meta.url)
    const rendererStyleSources = readdirSync(rendererDirectory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && (entry.name.endsWith('.css') || entry.name.endsWith('.vue')))
      .map((entry) => readFileSync(`${entry.parentPath}/${entry.name}`, 'utf8'))
    const sources = [
      ...rendererStyleSources,
      readFileSync(new URL('../src/main/home-page.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../src/main/browser/page-scripts.ts', import.meta.url), 'utf8')
    ]

    for (const source of sources) {
      const explicitSizes = [...source.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)]
        .map((match) => Number(match[1]))
      const shorthandSizes = [...source.matchAll(/\bfont:\s*['"]?(?:\d+\s+)?(\d+(?:\.\d+)?)px(?:\/|\s)/g)]
        .map((match) => Number(match[1]))

      expect([...explicitSizes, ...shorthandSizes].filter((size) => size < 11)).toEqual([])
    }
  })
})
