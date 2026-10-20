import type { BrowserPdfPageSize } from '../../../shared/types.js'

// The regions whose standard paper is US Letter, from the Unicode CLDR paper size data that operating systems and
// Chromium's print preview use. Everywhere else uses A4.
const LETTER_REGIONS: ReadonlySet<string> = new Set(['BZ', 'CA', 'CL', 'CO', 'CR', 'GT', 'MX', 'NI', 'PA', 'PH', 'PR', 'SV', 'US', 'VE'])

function localeRegion(locale: string): string | undefined {
  try {
    return new Intl.Locale(locale).maximize().region
  } catch {
    return undefined
  }
}

/**
 * The paper a PDF saved from Hronaut's own controls uses: the standard paper of
 * the region the operating system is set to, or of its language when it names
 * no region, so a page saved in Germany prints on A4 and one saved in the US on
 * Letter. Letter, as before, when neither names a region.
 */
export function regionalPdfPageSize(countryCode: string, systemLocale: string): BrowserPdfPageSize {
  const region = (/^[a-z]{2}$/i.test(countryCode) ? countryCode : localeRegion(systemLocale))?.toUpperCase()
  if (!region) return 'Letter'
  return LETTER_REGIONS.has(region) ? 'Letter' : 'A4'
}
