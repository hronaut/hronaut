/**
 * Keeps a held Enter from pressing a button again. Enter repeats while it is held, and a Remove that hands its focus
 * to the next row's Remove would otherwise remove one row after another until the key is let go. Removing the last
 * row hands the focus to the panel's Close, which takes it too. Elsewhere Hronaut keeps the focus off such a control
 * instead; a list's next row is where the focus belongs, so here the repeat is ignored. A review step whose confirm
 * button takes the focus on purpose ignores it too, so that confirming takes a new press.
 */
export function ignoreHeldEnter(event: KeyboardEvent): void {
  if (event.repeat && event.key === 'Enter') event.preventDefault()
}
