/** Runs in Save Page As's own isolated world: the type of the document the page shows, as Chromium has it. */
export function documentContentTypeInPage(): string {
  return document.contentType
}
