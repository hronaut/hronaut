/**
 * The answers for the addresses asked about lately, in main and in the shell. The shell asks for every tab whenever
 * the browser state changes, many times a second while pages load, and parsing each address again took a good part
 * of that time. Long addresses, such as data: pages, are parsed each time rather than kept.
 */
const answers = new Map<string, boolean>()
const MAX_ANSWERS = 512
const MAX_KEPT_URL_LENGTH = 2048

/** Only the internal Home host belongs to Hronaut's privileged Home surface. */
export function isHronautHomeUrl(url: string | null | undefined): boolean {
  if (!url) return false
  const known = answers.get(url)
  if (known !== undefined) return known
  let home: boolean
  try {
    const parsed = new URL(url)
    home = parsed.protocol === 'hronaut:'
      && parsed.hostname === 'home'
      && !parsed.port
      && !parsed.username
      && !parsed.password
  } catch {
    home = false
  }
  if (url.length > MAX_KEPT_URL_LENGTH) return home
  if (answers.size >= MAX_ANSWERS) answers.clear()
  answers.set(url, home)
  return home
}
