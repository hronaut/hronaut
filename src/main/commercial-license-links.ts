export const COMMERCIAL_LICENSE_PURCHASE_URL = 'https://hronaut.pages.dev'

export function commercialLicensePurchaseHandler<Event>(
  assertTrustedSender: (event: Event) => void,
  openExternal: (url: string) => Promise<unknown>
): (event: Event) => Promise<void> {
  return async (event: Event): Promise<void> => {
    assertTrustedSender(event)
    await openExternal(COMMERCIAL_LICENSE_PURCHASE_URL)
  }
}
