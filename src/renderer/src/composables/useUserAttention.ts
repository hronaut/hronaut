import { ref } from 'vue'
import type { HronautApi, UserAttentionRequest } from '../../../shared/types.js'

/**
 * What an agent is waiting on the person for, if anything. Changes arrive as events; the first read fills in only
 * when no change has arrived since it was asked, so a late answer never replaces a newer request.
 */
export function useUserAttention(browser: Pick<HronautApi, 'getUserAttention' | 'onUserAttentionChanged'>) {
  const request = ref<UserAttentionRequest | null>(null)
  let revision = 0
  const dispose = browser.onUserAttentionChanged((next) => {
    revision += 1
    request.value = next
  })
  const initialRevision = revision
  void browser.getUserAttention().then((initial) => {
    if (revision === initialRevision) request.value = initial
  })
  return { request, dispose }
}
