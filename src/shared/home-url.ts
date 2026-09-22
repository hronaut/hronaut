/** Only the internal Home host belongs to Hronaut's privileged Home surface. */
export function isHronautHomeUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'hronaut:'
      && parsed.hostname === 'home'
      && !parsed.port
      && !parsed.username
      && !parsed.password
  } catch {
    return false
  }
}
