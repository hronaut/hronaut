/** Runs in the page: the first of these texts the page's body shows, or null. */
export function pageTextMatchInPage(candidates: string[]): string | null {
  const pageText = document.body?.innerText ?? ''
  return candidates.find((candidate) => pageText.includes(candidate)) ?? null
}
