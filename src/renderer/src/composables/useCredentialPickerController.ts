import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { CredentialSummary } from '../../../shared/types.js'

type Translate = (key: string) => string

export interface CredentialPickerControllerOptions {
  open: Ref<boolean>
  credentials: Readonly<Ref<CredentialSummary[]>>
  origin: Readonly<Ref<string | null>>
  translate: Translate
  fillCredential: (credential: CredentialSummary) => unknown
}

export function useCredentialPickerController(options: CredentialPickerControllerOptions) {
  const input = ref<HTMLInputElement | null>(null)
  const query = ref('')
  const selection = ref(0)
  const activeCredentials = computed(() => options.origin.value
    ? options.credentials.value.filter((credential) => credential.origin === options.origin.value)
    : [])
  const credentials = computed(() => {
    const normalizedQuery = query.value.trim().toLocaleLowerCase()
    if (!normalizedQuery) return activeCredentials.value
    return activeCredentials.value.filter((credential) => (
      (credential.username || options.translate('credentialPicker.unnamed')).toLocaleLowerCase().includes(normalizedQuery)
      || credential.origin.toLocaleLowerCase().includes(normalizedQuery)
    ))
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

  function restoreFocusAndReveal(): void {
    if (options.open.value) input.value?.focus({ preventScroll: true })
    revealSelectedCredential()
  }

  async function openPanel(): Promise<void> {
    query.value = ''
    selection.value = 0
    options.open.value = true
    await nextTick()
    if (!options.open.value) return
    input.value?.focus()
    input.value?.select()
    revealSelectedCredential()
  }

  function close(): void {
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
    await nextTick()
    revealSelectedCredential()
  }

  function handleKeydown(event: KeyboardEvent): void {
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
      void nextTick().then(restoreFocusAndReveal)
    },
    { flush: 'sync' }
  )
  const stopOriginTracking = watch(options.origin, (nextOrigin, previousOrigin) => {
    if (nextOrigin !== previousOrigin) close()
  }, { flush: 'sync' })

  function dispose(): void {
    stopCredentialTracking()
    stopOriginTracking()
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
