export interface CredentialFillContext {
  origin: string
  url: string
  navigationGeneration: number
  tabSelectionGeneration: number
}

export function credentialFillContext(
  url: string,
  navigationGeneration: number,
  tabSelectionGeneration: number
): CredentialFillContext | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return {
      origin: parsed.origin,
      url: parsed.href,
      navigationGeneration,
      tabSelectionGeneration
    }
  } catch {
    return null
  }
}

export function isCurrentCredentialFillContext(
  expected: CredentialFillContext | null,
  current: CredentialFillContext | null
): boolean {
  return expected !== null
    && current !== null
    && current.origin === expected.origin
    && current.url === expected.url
    && current.navigationGeneration === expected.navigationGeneration
    && current.tabSelectionGeneration === expected.tabSelectionGeneration
}
