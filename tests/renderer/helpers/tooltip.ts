/** The control whose themed tooltip reads exactly `text`, as `getByTitle` found a native title. */
export function getByTooltip(text: string, container: ParentNode = document): HTMLElement {
  const matches = [...container.querySelectorAll<HTMLElement>('[data-tooltip]')].filter((element) => element.dataset.tooltip === text)
  if (matches.length !== 1) throw new Error(`Expected one control with the tooltip "${text}", found ${matches.length}`)
  return matches[0]
}

/** The control whose themed tooltip reads exactly `text`, or null. */
export function queryByTooltip(text: string, container: ParentNode = document): HTMLElement | null {
  return [...container.querySelectorAll<HTMLElement>('[data-tooltip]')].find((element) => element.dataset.tooltip === text) ?? null
}
