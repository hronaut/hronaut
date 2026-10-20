/**
 * Keeps a held Enter from pressing a button again. Enter repeats while it is held, and a Remove that hands its focus
 * to the next row's Remove would otherwise remove one row after another until the key is let go.
 */
export function ignoreHeldEnter(event: KeyboardEvent): void {
  if (event.repeat && event.key === 'Enter') event.preventDefault()
}
