import { BROWSER_TOOL_CATALOG } from '../src/main/mcp/tool-catalog.js'
import { describe, it, expect } from 'vitest'
import { normalizeSizingInputs, sizingInputValue, SIZING_INPUT_PROPERTIES } from '../src/shared/element-sizing-inputs.js'
import { normalizeElementInspection, formatElementInspectionForAgent } from '../src/shared/element-inspection.js'

describe('bounded computed sizing inputs', () => {
  it.each(['auto', '50%', '0px', '12.5px', 'min-content', 'max-content', 'fit-content', 'content'])('preserves supported basis %s without resolving it', value => {
    expect(sizingInputValue('flex-basis', value)).toBe(value)
  })
  it.each(['calc(50% + 2px)', 'url(PRIVATE)', 'anchor-size(PRIVATE)', '1px PRIVATE', '-1px', '1e99px', '1000000001px', '1'.repeat(65), '', 'NaN', 'Infinity'])('omits unsupported CSS token %s', value => {
    expect(sizingInputValue('flex-basis', value)).toBeNull()
  })
  it('separates numbers, keywords, geometry and arbitrary content', () => {
    expect(sizingInputValue('flex-grow', '1e+2')).toBe(100)
    expect(sizingInputValue('flex-shrink', '-1')).toBeNull()
    expect(sizingInputValue('flex-grow', '1e99')).toBeNull()
    expect(sizingInputValue('min-width', 'none')).toBeNull()
    expect(sizingInputValue('max-width', 'none')).toBe('none')
    expect(sizingInputValue('align-self', 'PRIVATE')).toBeNull()
    expect(sizingInputValue('align-self', 'safe center')).toBe('safe center')
    const result = normalizeSizingInputs({ 'flex-grow': 1, 'flex-basis': '50%', parent: 'PRIVATE', 'max-height': ['SECRET'] })
    expect(Object.keys(result)).toEqual([...SIZING_INPUT_PROPERTIES])
    expect(result['flex-grow']).toBe(1)
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SECRET/)
    expect(JSON.stringify(result).length).toBeLessThan(600)
  })
  it('leaves defaults unchanged and labels the selected-element limits in presentation', () => {
    const input = { tabId: 'tab', title: '', url: 'https://example.test', raw: { selector: '#target', tag: 'div' } }
    expect(normalizeElementInspection(input)).not.toHaveProperty('sizingInputs')
    const report = normalizeElementInspection({ ...input, raw: { ...input.raw, sizingInputs: { 'flex-grow': 1 } } })
    expect(formatElementInspectionForAgent(report)).toContain('not flex participation, applicability, parent context, cause, resolved base size or cascade winner')
  })
})

it('shows the partial selected-element scope in the tool catalog used by Home UI', () => {
  const description = BROWSER_TOOL_CATALOG.find(tool => tool.name === 'browser_element_inspect')!.description
  expect(description).toContain('includeSizingInputs')
  expect(description).toContain('no parent collection or flex participation, applicability, cause, resolved base size or cascade winner claim')
})
