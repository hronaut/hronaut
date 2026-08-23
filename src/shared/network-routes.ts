export function networkRoutePatternMatches(pattern: string, url: string): boolean {
  const tokens: Array<'*' | '?' | { literal: string }> = []
  let escaped = false
  for (const character of pattern) {
    if (escaped) {
      tokens.push({ literal: character })
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '*' || character === '?') tokens.push(character)
    else tokens.push({ literal: character })
  }
  if (escaped) tokens.push({ literal: '\\' })

  let tokenIndex = 0
  let urlIndex = 0
  let starIndex = -1
  let starUrlIndex = 0
  while (urlIndex < url.length) {
    const token = tokens[tokenIndex]
    if (token === '?' || (typeof token === 'object' && token.literal === url[urlIndex])) {
      tokenIndex += 1
      urlIndex += 1
      continue
    }
    if (token === '*') {
      starIndex = tokenIndex
      starUrlIndex = urlIndex
      tokenIndex += 1
      continue
    }
    if (starIndex < 0) return false
    tokenIndex = starIndex + 1
    starUrlIndex += 1
    urlIndex = starUrlIndex
  }
  while (tokens[tokenIndex] === '*') tokenIndex += 1
  return tokenIndex === tokens.length
}

export function validateNetworkRoutePattern(pattern: string): string {
  if (!pattern || pattern.length > 2_048) {
    throw new Error('Network route URL pattern must contain between 1 and 2,048 characters')
  }
  if (/[\u0000-\u001f\u007f]/.test(pattern)) {
    throw new Error('Network route URL pattern cannot contain control characters')
  }
  if (!pattern.includes('://') && !pattern.startsWith('*')) {
    throw new Error('Network route URL pattern must include a scheme, for example https://api.example.com/*')
  }
  return pattern
}
