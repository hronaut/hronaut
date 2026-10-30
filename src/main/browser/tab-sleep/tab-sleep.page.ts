/**
 * Runs in the page: whether the document holds form input the person changed, including fields inside open shadow
 * roots, or edited content its watcher recorded.
 */
export function formStateChangedInPage(): boolean {
  const changed = (field: Element): boolean => {
    if (field instanceof HTMLInputElement) {
      const type = (field.getAttribute('type') || 'text').toLowerCase()
      if (['button', 'submit', 'reset', 'image', 'hidden'].includes(type)) return false
      if (type === 'checkbox' || type === 'radio') return field.checked !== field.defaultChecked
      if (type === 'file') return (field.files?.length || 0) > 0
      return field.value !== field.defaultValue
    }
    if (field instanceof HTMLTextAreaElement) return field.value !== field.defaultValue
    if (field instanceof HTMLSelectElement) {
      if (field.multiple) return [...field.options].some((option) => option.selected !== option.defaultSelected)
      const explicitDefault = [...field.options].findIndex((option) => option.defaultSelected)
      const defaultIndex = explicitDefault >= 0 ? explicitDefault : field.options.length > 0 ? 0 : -1
      return field.selectedIndex !== defaultIndex
    }
    return false
  }
  const roots: Array<Document | ShadowRoot> = [document]
  for (let index = 0; index < roots.length; index += 1) {
    for (const element of roots[index]!.querySelectorAll('*')) {
      if (changed(element)) return true
      if (element.shadowRoot) roots.push(element.shadowRoot)
    }
  }
  return (window as unknown as { __hronautContentEditableDirty?: boolean }).__hronautContentEditableDirty === true
}

/**
 * Runs in the page: whether a video of the document shows in Picture in picture, or the document opened a Picture in
 * picture window of its own; a video in a shadow root shows as its root's host. A document without these APIs shows none.
 */
export function pictureInPictureShownInPage(): boolean {
  const documentPip = (window as unknown as { documentPictureInPicture?: { window?: Window | null } | null }).documentPictureInPicture
  return document.pictureInPictureElement != null || (typeof documentPip === 'object' && documentPip?.window != null)
}
