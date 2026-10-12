import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { CredentialSummary } from '../../../shared/types.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'

type Translate = (key: string) => string

export interface CredentialPickerControllerOptions {
  open: Ref<boolean>
  panel: Readonly<Ref<HTMLElement | null>>
  credentials: Readonly<Ref<CredentialSummary[]>>
  origin: Readonly<Ref<string | null>>
  locale?: Readonly<Ref<string>>
  translate: Translate
  fillCredential: (credential: CredentialSummary) => unknown
}

export function useCredentialPickerController(options: CredentialPickerControllerOptions) {
  const input = ref<HTMLInputElement | null>(null)
  const query = ref('')
  const selection = ref(0)
  let presentation = 0
  let disposed = false
  const activeCredentials = computed(() => options.origin.value
    ? options.credentials.value.filter((credential) => credential.origin === options.origin.value)
    : [])
  const credentials = computed(() => {
    const locale = options.locale?.value
    const terms = query.value.trim().toLocaleLowerCase(locale).split(/\s+/).filter(Boolean)
    if (!terms.length) return activeCredentials.value
    return activeCredentials.value.filter((credential) => {
      const text = [credential.username || options.translate('credentialPicker.unnamed'), credential.origin]
        .join('\n').toLocaleLowerCase(locale)
      return terms.every(term => text.includes(term))
    })
  })
  const credentialIds = computed(() => credentials.value.map((credential) => credential.id))
  const selectedCredential = computed(() => credentials.value[selection.value])

  function credentialOptionId(credential: CredentialSummary): string {
    return `credential-option-${credential.id}`
  }

  function revealSelectedCredential(): void {
    const credential = selectedCredential.value
    if (!credential) return
    document.getElementById(credentialOptionId(credential))?.scrollIntoView?.({ block: 'nearest' })
  }

  function isCurrent(expectedPresentation: number): boolean {
    return !disposed && options.open.value && expectedPresentation === presentation
  }

  function restoreFocusAndReveal(expectedPresentation: number, previousFocus: Element | null): void {
    if (!isCurrent(expectedPresentation)) return
    const panel = options.panel.value
    const active = document.activeElement
    // Keep the operator's current control, including a choice made while Vue
    // was updating. Moving a keyed account row can blur its retained button.
    if (!panel?.contains(active)) {
      const retained = active === document.body && previousFocus instanceof HTMLElement
        && panel?.contains(previousFocus) ? previousFocus : input.value
      retained?.focus({ preventScroll: true })
    }
    revealSelectedCredential()
  }

  async function openPanel(): Promise<void> {
    const currentPresentation = ++presentation
    query.value = ''
    selection.value = 0
    options.open.value = true
    await nextTick()
    if (!isCurrent(currentPresentation)) return
    input.value?.focus()
    input.value?.select()
    revealSelectedCredential()
  }

  function close(): void {
    presentation += 1
    options.open.value = false
  }

  async function fill(credential: CredentialSummary): Promise<void> {
    close()
    await options.fillCredential(credential)
  }

  async function fillSelectedCredential(): Promise<void> {
    if (selectedCredential.value) await fill(selectedCredential.value)
  }

  async function moveSelection(offset: -1 | 1): Promise<void> {
    if (!credentials.value.length) return
    selection.value = (selection.value + offset + credentials.value.length) % credentials.value.length
    const currentPresentation = presentation
    await nextTick()
    if (isCurrent(currentPresentation)) revealSelectedCredential()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (isImeCompositionEvent(event)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (!credentials.value.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      void moveSelection(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      void moveSelection(-1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      void fillSelectedCredential()
    }
  }

  const stopCredentialTracking = watch(
    [query, credentialIds],
    ([nextQuery, nextIds], [previousQuery, previousIds]) => {
      if (nextQuery !== previousQuery) {
        selection.value = 0
      } else {
        const previousId = previousIds[selection.value]
        const preservedIndex = previousId ? nextIds.indexOf(previousId) : -1
        selection.value = preservedIndex >= 0
          ? preservedIndex
          : Math.min(selection.value, Math.max(0, nextIds.length - 1))
      }
      if (!options.open.value || disposed) return
      const currentPresentation = presentation
      const previousFocus = document.activeElement
      void nextTick().then(() => restoreFocusAndReveal(currentPresentation, previousFocus))
    },
    { flush: 'sync' }
  )
  const stopOpenTracking = watch(options.open, (open) => {
    if (!open) presentation += 1
  }, { flush: 'sync' })
  const stopOriginTracking = watch(options.origin, (nextOrigin, previousOrigin) => {
    if (nextOrigin !== previousOrigin) close()
  }, { flush: 'sync' })

  function dispose(): void {
    disposed = true
    presentation += 1
    stopCredentialTracking()
    stopOriginTracking()
    stopOpenTracking()
  }

  return {
    input,
    query,
    selection,
    credentials,
    credentialIds,
    selectedCredential,
    credentialOptionId,
    openPanel,
    close,
    fill,
    moveSelection,
    handleKeydown,
    dispose
  }
}
