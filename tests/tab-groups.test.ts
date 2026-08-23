import { describe, expect, it } from 'vitest'
import {
  BROWSER_TAB_GROUP_COLORS,
  defaultTabGroupColor,
  isBrowserTabGroupColor,
  tabGroupColorLabel
} from '../src/shared/tab-groups.js'

describe('tab group colors', () => {
  it('accepts only the public palette', () => {
    for (const color of BROWSER_TAB_GROUP_COLORS) expect(isBrowserTabGroupColor(color)).toBe(true)
    expect(isBrowserTabGroupColor('violet')).toBe(false)
    expect(isBrowserTabGroupColor(undefined)).toBe(false)
  })

  it('derives a stable valid migration color and human label', () => {
    expect(defaultTabGroupColor('group-a')).toBe(defaultTabGroupColor('group-a'))
    expect(BROWSER_TAB_GROUP_COLORS).toContain(defaultTabGroupColor('group-a'))
    expect(tabGroupColorLabel('orange')).toBe('Orange')
  })
})
