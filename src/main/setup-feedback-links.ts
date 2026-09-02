export const SETUP_FEEDBACK_URL = 'https://hronaut.dev/go/desktop-setup-feedback'
export const SETUP_HELP_URL = 'https://hronaut.dev/go/desktop-setup-help'

function fixedExternalLinkHandler<Event>(
  url: string,
  assertTrustedSender: (event: Event) => void,
  openExternal: (url: string) => Promise<unknown>
): (event: Event) => Promise<void> {
  return async (event: Event): Promise<void> => {
    assertTrustedSender(event)
    await openExternal(url)
  }
}

export function setupFeedbackHandler<Event>(
  assertTrustedSender: (event: Event) => void,
  openExternal: (url: string) => Promise<unknown>
): (event: Event) => Promise<void> {
  return fixedExternalLinkHandler(SETUP_FEEDBACK_URL, assertTrustedSender, openExternal)
}

export function setupHelpHandler<Event>(
  assertTrustedSender: (event: Event) => void,
  openExternal: (url: string) => Promise<unknown>
): (event: Event) => Promise<void> {
  return fixedExternalLinkHandler(SETUP_HELP_URL, assertTrustedSender, openExternal)
}
