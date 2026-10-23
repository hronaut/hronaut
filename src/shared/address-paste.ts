const JAVASCRIPT_SCHEME = 'javascript:'

/** Whether a run of white space holds a line break. */
function breaksLine(run: string): boolean {
  return /[\r\n]/u.test(run)
}

/**
 * Text pasted into the address bar as Chrome's address bar reads it (omnibox::SanitizeTextForPaste): trimmed, with
 * each run of white space that holds a line break made one space when the text has other spaces, so an address that
 * runs over lines reads whole and lines of words keep their spaces, while runs without a line break stay as they are.
 * Any leading javascript: scheme is dropped, so pasted script never runs from the address bar.
 */
export function addressPasteText(text: string): string {
  const trimmed = text.trim()
  const joiner = (trimmed.match(/\s+/gu) ?? []).some((run) => !breaksLine(run)) ? ' ' : ''
  const collapsed = trimmed.replace(/\s+/gu, (run) => breaksLine(run) ? joiner : run)
  let index = 0
  let scheme = false
  while (index < collapsed.length) {
    if (/\s/u.test(collapsed[index]!) || collapsed.charCodeAt(index) < 0x20) {
      index += 1
    } else if (collapsed.slice(index, index + JAVASCRIPT_SCHEME.length).replace(/[A-Z]/g, (letter) => letter.toLowerCase()) === JAVASCRIPT_SCHEME) {
      // As in Chrome, "javascript:javascript:..." loses every one.
      scheme = true
      index += JAVASCRIPT_SCHEME.length
    } else {
      break
    }
  }
  return scheme ? collapsed.slice(index) : collapsed
}
