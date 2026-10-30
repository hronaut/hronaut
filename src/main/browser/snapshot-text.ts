import { pageScript } from '../../shared/page-script.js'
import { snapshotTextInPage, type SnapshotTextOptions } from './snapshot-text.page.js'

/**
 * The capture's text collection as statements for a page script still written as text: `snapshotText`, and its
 * `snapshotEditingContext`, `snapshotSafeText` and `resetSnapshotText`. Never clear or clone editors into the live page.
 */
export function snapshotTextHelpersSource(options: SnapshotTextOptions, maxChars: number): string {
  return `
    const snapshotText = ${pageScript(snapshotTextInPage, options, maxChars)};
    const { editingContext: snapshotEditingContext, safeText: snapshotSafeText, reset: resetSnapshotText } = snapshotText;
  `
}
