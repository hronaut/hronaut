/** Keep a UTF-16 length limit without leaving the first half of a surrogate pair. */
export function truncateText(value: string, maxLength: number): string {
  const bounded = value.slice(0, maxLength)
  const lastCodeUnit = bounded.charCodeAt(bounded.length - 1)
  return lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff
    ? bounded.slice(0, -1)
    : bounded
}
