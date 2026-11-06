/** The longest site icon kept: a 32 pixel PNG data URL, as a tab shows a website's icon, is far shorter. */
export const MAX_SITE_ICON_LENGTH = 16 * 1024

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/

/** The website a page's icon is kept for: the origin of its web address, or null for any other address. */
export function siteIconOrigin(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null
  } catch {
    return null
  }
}

/** Whether this is an icon as Hronaut keeps a website's: a PNG data URL no longer than MAX_SITE_ICON_LENGTH. */
export function isSiteIcon(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_SITE_ICON_LENGTH && PNG_DATA_URL.test(value)
}
