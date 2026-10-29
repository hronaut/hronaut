import { computed, ref, shallowRef } from 'vue'
import type { HronautTrustedDialogsApi, TrustedDialogCredentials, TrustedDialogRequest } from '../../../shared/trusted-dialogs.js'

/**
 * Mirrors the one dialog main asks this shell window to show, such as a website's permission request, and reports
 * the person's answer. Main decides which answer counts: the shell sends each request's answer at most once, and an
 * answer for a dialog main has already closed or replaced changes nothing there.
 */
export function useTrustedDialogController(api: HronautTrustedDialogsApi | undefined) {
  const request = shallowRef<TrustedDialogRequest | null>(null)
  /** The request the person already answered, while main has not yet shown the next one. */
  const answeredId = ref<string>()
  const open = computed(() => request.value !== null)
  const answering = computed(() => Boolean(request.value && answeredId.value === request.value.id))
  /** The request main last closed or replaced before the person answered it, as when a sign-in's page loads another. */
  const closedUnanswered = shallowRef<TrustedDialogRequest | null>(null)

  const stop = api?.onChanged((next) => {
    const previous = request.value
    closedUnanswered.value = previous && previous.id !== next?.id && answeredId.value !== previous.id ? previous : null
    request.value = next
    if (next?.id !== answeredId.value) answeredId.value = undefined
  })
  // Only now can main show dialogs here; until then it asks with the system dialog instead.
  api?.ready()

  /**
   * Answers the request with this id, if it is still the one shown and not answered yet; signing in to a website
   * sends what the person typed with it.
   */
  function respond(id: string, response: number, credentials?: TrustedDialogCredentials): void {
    const current = request.value
    if (!current || current.id !== id || answeredId.value === id) return
    if (!Number.isInteger(response) || response < 0 || response >= current.buttons.length) return
    answeredId.value = id
    if (credentials) api?.respond(id, response, credentials)
    else api?.respond(id, response)
  }

  /** Answers the shown request as Escape does. */
  function cancel(): void {
    const current = request.value
    if (current) respond(current.id, current.cancelId)
  }

  function dispose(): void {
    stop?.()
  }

  return { request, open, answering, closedUnanswered, respond, cancel, dispose }
}

export type TrustedDialogController = ReturnType<typeof useTrustedDialogController>
