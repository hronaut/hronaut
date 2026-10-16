import type { ObjectDirective } from 'vue'

// Attributes this directive set, so it never removes or replaces an author's own. A name stays
// the directive's only while the control still carries exactly that name.
const named = new WeakMap<HTMLElement, string>()
const described = new WeakMap<HTMLElement, string>()

/** A control whose only name was its native title, such as an icon button without a label. */
function nameless(element: HTMLElement): boolean {
  if (element.hasAttribute('aria-labelledby') || element.matches('input, select, textarea')) return false
  if (element.hasAttribute('aria-label') && !ownName(element)) return false
  return !element.textContent?.trim()
}

function ownName(element: HTMLElement): boolean {
  return named.has(element) && named.get(element) === element.getAttribute('aria-label')
}

function apply(element: HTMLElement, text: string | null | undefined): void {
  const value = text?.trim() ? text : ''
  if (value) element.dataset.tooltip = value
  else delete element.dataset.tooltip
  // A native title named a control that had no other name, and described one whose name it did not repeat.
  if (value && nameless(element)) {
    element.setAttribute('aria-label', value)
    named.set(element, value)
  } else if (named.has(element)) {
    if (ownName(element)) element.removeAttribute('aria-label')
    named.delete(element)
  }
  const ownDescription = described.has(element) && described.get(element) === element.getAttribute('aria-description')
  // A description the control binds itself replaces this one, and is never removed.
  if (!ownDescription) described.delete(element)
  if (ownDescription || !element.hasAttribute('aria-description')) {
    if (value && value !== element.getAttribute('aria-label')) {
      element.setAttribute('aria-description', value)
      described.set(element, value)
    } else if (ownDescription) {
      element.removeAttribute('aria-description')
      described.delete(element)
    }
  }
}

/**
 * `v-tooltip="text"` gives a control a themed tooltip in place of a native `title`. The shell's
 * tooltip controller (installShellTooltips) shows it above the page when the pointer rests on the
 * control. Placement comes from the nearest `data-tooltip-placement`, below the control by default.
 */
export const vTooltip: ObjectDirective<HTMLElement, string | null | undefined> = {
  mounted: (element, binding) => apply(element, binding.value),
  updated: (element, binding) => apply(element, binding.value)
}
