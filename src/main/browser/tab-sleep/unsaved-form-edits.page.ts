/** The flags the watcher keeps on the page's window. */
interface FormEditsWindow {
  __hronautFormEditTrackingInstalled?: boolean
  __hronautContentEditableDirty?: boolean
}

/** Runs in the page: records in the document whether the person edits editable content, which forms do not show, inside shadow roots too. */
export function watchFormEditsInPage(): void {
  const page = window as unknown as FormEditsWindow
  if (page.__hronautFormEditTrackingInstalled) return
  page.__hronautFormEditTrackingInstalled = true
  page.__hronautContentEditableDirty = false
  document.addEventListener('input', (event) => {
    const target = event.composedPath()[0]
    if (target instanceof HTMLElement && target.isContentEditable) {
      page.__hronautContentEditableDirty = true
    }
  }, true)
}
