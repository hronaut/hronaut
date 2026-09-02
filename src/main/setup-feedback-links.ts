export const SETUP_FEEDBACK_URL = 'https://hronaut.dev/go/desktop-setup-feedback'

export function setupFeedbackHandler<Event>(
  assertTrustedSender: (event: Event) => void,
  openExternal: (url: string) => Promise<unknown>
): (event: Event) => Promise<void> {
  return async (event: Event): Promise<void> => {
    assertTrustedSender(event)
    await openExternal(SETUP_FEEDBACK_URL)
  }
}
