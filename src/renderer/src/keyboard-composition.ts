export function isImeCompositionEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}
