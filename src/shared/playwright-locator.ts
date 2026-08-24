export type BrowserLocatorStrategy =
  | 'role'
  | 'label'
  | 'test-id'
  | 'placeholder'
  | 'alt-text'
  | 'title'
  | 'css'

export interface BrowserLocatorCandidate {
  strategy: Exclude<BrowserLocatorStrategy, 'css'>
  value: string
  role?: string
}

export interface BrowserGeneratedLocator {
  tabId: string
  locator: string
  strategy: BrowserLocatorStrategy
  selector: string
  caveats: string[]
}

interface RawBrowserLocatorResult {
  selector?: unknown
  candidates?: unknown
}

const STRATEGIES = new Set<BrowserLocatorCandidate['strategy']>([
  'role',
  'label',
  'test-id',
  'placeholder',
  'alt-text',
  'title'
])

function boundedText(value: unknown, maximum: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum)
    : ''
}

function locatorFor(candidate: BrowserLocatorCandidate): string {
  const value = JSON.stringify(candidate.value)
  if (candidate.strategy === 'role') {
    return `page.getByRole(${JSON.stringify(candidate.role)}, { name: ${value}, exact: true })`
  }
  if (candidate.strategy === 'label') return `page.getByLabel(${value}, { exact: true })`
  if (candidate.strategy === 'test-id') return `page.getByTestId(${value})`
  if (candidate.strategy === 'placeholder') return `page.getByPlaceholder(${value}, { exact: true })`
  if (candidate.strategy === 'alt-text') return `page.getByAltText(${value}, { exact: true })`
  return `page.getByTitle(${value}, { exact: true })`
}

export function normalizeBrowserGeneratedLocator(
  tabId: string,
  raw: RawBrowserLocatorResult
): BrowserGeneratedLocator {
  const selector = boundedText(raw.selector, 1_000)
  if (!selector) throw new Error('The selected element did not produce a usable selector')
  const candidates = Array.isArray(raw.candidates)
    ? raw.candidates.flatMap((value): BrowserLocatorCandidate[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const record = value as Record<string, unknown>
      const strategy = boundedText(record.strategy, 32) as BrowserLocatorCandidate['strategy']
      const candidateValue = boundedText(record.value, 500)
      if (!STRATEGIES.has(strategy) || !candidateValue) return []
      if (strategy === 'role') {
        const role = boundedText(record.role, 64)
        if (!role) return []
        return [{ strategy, role, value: candidateValue }]
      }
      return [{ strategy, value: candidateValue }]
    })
    : []
  const candidate = candidates[0]
  if (candidate) {
    return {
      tabId,
      locator: locatorFor(candidate),
      strategy: candidate.strategy,
      selector,
      caveats: [
        'The locator uniquely matched the current document when generated; keep an assertion near it because page content can change.'
      ]
    }
  }
  return {
    tabId,
    locator: `page.locator(${JSON.stringify(selector)})`,
    strategy: 'css',
    selector,
    caveats: [
      'No unique semantic locator was available, so this uses a unique current-document CSS selector that may be more sensitive to DOM changes.'
    ]
  }
}
