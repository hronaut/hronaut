export const COMMERCIAL_LICENSE_PURCHASE_URL = 'https://hronaut.dev/#pricing'
/** A one-question page asking a person whose trial ended what kept them from buying; nothing about them is sent. */
export const TRIAL_FEEDBACK_URL = 'https://hronaut.dev/go/desktop-trial-feedback'
export const COMMERCIAL_LICENSE_API_BASE_URL = 'https://hronaut.dev/api/creem-license'

export function commercialLicensePurchaseHandler<Event>(
  assertTrustedSender: (event: Event) => void,
  openExternal: (url: string) => Promise<unknown>
): (event: Event) => Promise<void> {
  return async (event: Event): Promise<void> => {
    assertTrustedSender(event)
    await openExternal(COMMERCIAL_LICENSE_PURCHASE_URL)
  }
}

export function trialFeedbackHandler<Event>(
  assertTrustedSender: (event: Event) => void,
  openExternal: (url: string) => Promise<unknown>
): (event: Event) => Promise<void> {
  return async (event: Event): Promise<void> => {
    assertTrustedSender(event)
    await openExternal(TRIAL_FEEDBACK_URL)
  }
}
