import { describe, expect, it } from 'vitest'
import { DESIGN_OVERVIEW_LIMITS, designOverviewPageScript } from '../src/shared/design-overview.js'

describe('design overview', () => {
  it('keeps the computed-style sample and returned collections bounded', () => {
    expect(DESIGN_OVERVIEW_LIMITS).toEqual({
      maxElements: 2_500,
      maxColors: 24,
      maxFonts: 24,
      maxContrastIssues: 25,
      maxMediaQueries: 30,
      maxCssRules: 20_000
    })
    const script = designOverviewPageScript()
    expect(script).toContain('getComputedStyle')
    expect(script).toContain('maxElements')
    expect(script).toContain('requiredRatio')
    expect(script).toContain('4.5')
  })

  it('does not collect CSS source, body text, field values, IDs, classes, or markup', () => {
    const script = designOverviewPageScript()
    for (const unsafe of ['innerHTML', 'outerHTML', 'textContent', '.value', '.id', 'className', 'styleSheetText']) {
      expect(script).not.toContain(unsafe)
    }
  })
})
