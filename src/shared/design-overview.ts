import { designOverviewInPage } from './design-overview.page.js'
import { pageScript } from './page-script.js'

export const DESIGN_OVERVIEW_LIMITS = {
  maxElements: 2_500,
  maxColors: 24,
  maxFonts: 24,
  maxContrastIssues: 25,
  maxMediaQueries: 30,
  maxCssRules: 20_000
} as const

/** The isolated-world script that reads the design overview of the page. */
export function designOverviewPageScript(): string {
  return pageScript(designOverviewInPage, DESIGN_OVERVIEW_LIMITS)
}
