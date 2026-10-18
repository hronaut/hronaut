export interface BrowserDesignOverviewColor {
  value: string
  count: number
}

export interface BrowserDesignOverviewFont {
  family: string
  sizePx: number | null
  weight: string
  lineHeight: string
  count: number
}

export interface BrowserDesignOverviewContrastIssue {
  selector: string
  foreground: string
  background: string
  ratio: number
  requiredRatio: number
  fontSizePx: number | null
  fontWeight: string
  largeText: boolean
}

export interface BrowserDesignOverviewReport {
  tabId: string
  url: string
  title: string
  capturedAt: string
  summary: {
    elementCount: number
    elementsScanned: number
    visibleElements: number
    textElementsChecked: number
    styleSheetCount: number
    accessibleStyleSheets: number
    inaccessibleStyleSheets: number
    cssRuleCount: number
    textColorCount: number
    backgroundColorCount: number
    borderColorCount: number
    fontCombinationCount: number
    contrastIssueCount: number
    truncated: boolean
  }
  colors: {
    text: BrowserDesignOverviewColor[]
    background: BrowserDesignOverviewColor[]
    border: BrowserDesignOverviewColor[]
  }
  fonts: BrowserDesignOverviewFont[]
  mediaQueries: Array<{ query: string; count: number }>
  contrastIssues: BrowserDesignOverviewContrastIssue[]
  caveats: string[]
}

export type BrowserPageMetadataIssueSeverity = 'error' | 'warning' | 'info'

export interface BrowserPageMetadataIssue {
  severity: BrowserPageMetadataIssueSeverity
  code: string
  message: string
}

export interface BrowserPageMetadataSocialImage {
  url: string
  alt: string | null
  width?: string | null
  height?: string | null
}

export interface BrowserPageMetadataReport {
  tabId: string
  url: string
  title: string
  capturedAt: string
  document: {
    language: string | null
    charset: string | null
    viewport: string | null
    description: string | null
    robots: string | null
    themeColor: string | null
    manifestUrl: string | null
    titleElementCount: number
    descriptionCount: number
    canonicalUrls: string[]
    headingCounts: Record<'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6', number>
  }
  openGraph: {
    title: string | null
    type: string | null
    url: string | null
    description: string | null
    siteName: string | null
    locale: string | null
    images: BrowserPageMetadataSocialImage[]
    propertyCount: number
  }
  twitter: {
    card: string | null
    title: string | null
    description: string | null
    site: string | null
    creator: string | null
    images: BrowserPageMetadataSocialImage[]
    propertyCount: number
  }
  alternateLinks: Array<{ language: string; url: string }>
  icons: Array<{ rel: string; type: string | null; sizes: string | null; url: string }>
  structuredData: {
    blockCount: number
    validBlockCount: number
    invalidBlockCount: number
    types: string[]
    blocks: Array<{ index: number; valid: boolean; types: string[]; error?: string }>
    truncated: boolean
  }
  issues: BrowserPageMetadataIssue[]
  caveats: string[]
}

export type BrowserSecurityState = 'unknown' | 'neutral' | 'insecure' | 'secure' | 'info' | 'insecure-broken'

export interface BrowserSecurityReport {
  tabId: string
  url: string
  origin: string | null
  title: string
  checkedAt: string
  state: BrowserSecurityState
  secureTransport: boolean
  connection?: {
    protocol: string
    cipher?: string
    keyExchange?: string
    keyExchangeGroup?: string
    certificateTransparencyCompliance?: string
    encryptedClientHello?: boolean
  }
  certificate?: {
    subjectName: string
    issuer: string
    sanList: string[]
    sanCount: number
    validFrom: string
    validTo: string
    valid: boolean
    expired: boolean
    notYetValid: boolean
    daysUntilExpiry: number
  }
  caveats: string[]
}

export type BrowserQualityAuditStatus = 'pass' | 'warning' | 'error'
export type BrowserQualityAuditCategoryStatus = BrowserQualityAuditStatus | 'info' | 'not-applicable'
export type BrowserQualityAuditCategoryId =
  | 'accessibility'
  | 'performance'
  | 'metadata'
  | 'security'
  | 'pwa'
  | 'browser-issues'

export interface BrowserQualityAuditFinding {
  category: BrowserQualityAuditCategoryId
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
}

export interface BrowserQualityAuditCategory {
  id: BrowserQualityAuditCategoryId
  label: string
  status: BrowserQualityAuditCategoryStatus
  summary: string
  findingCount: number
  evidence: string[]
}

export interface BrowserQualityAudit {
  tabId: string
  url: string
  title: string
  auditedAt: string
  status: BrowserQualityAuditStatus
  totals: {
    errors: number
    warnings: number
    info: number
  }
  categories: BrowserQualityAuditCategory[]
  findings: BrowserQualityAuditFinding[]
  truncated: boolean
  caveats: string[]
}
