import { pageScript } from './page-script.js'
import { pageMetadataInPage } from './page-metadata.page.js'

export const OMITTED_METADATA_URL = '[URL omitted: exceeds diagnostic limit]'

export const PAGE_METADATA_LIMITS = {
  maxTextChars: 1_024,
  maxUrlChars: 2_048,
  maxCanonicalUrls: 5,
  maxAlternateLinks: 20,
  maxIcons: 10,
  maxSocialImages: 5,
  maxStructuredDataBlocks: 20,
  maxStructuredDataTypes: 50,
  maxStructuredDataNodes: 200
} as const

export type PageMetadataLimits = typeof PAGE_METADATA_LIMITS

export function pageMetadataScript(): string {
  return pageScript(pageMetadataInPage, PAGE_METADATA_LIMITS, OMITTED_METADATA_URL)
}
