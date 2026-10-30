import { pageScript } from '../../shared/page-script.js'
import { renderedVisibilityInPage } from './rendered-visibility.page.js'

/** The visibility check as statements for a page script still written as text: `renderedVisible`, which throws `renderedVisibilityLimit`. */
export function renderedVisibilityHelpersSource(): string {
  return `const { visible: renderedVisible, limit: renderedVisibilityLimit } = ${pageScript(renderedVisibilityInPage)};`
}
