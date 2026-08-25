export const COMMERCIAL_LICENSE_PURCHASE_URL = 'https://hronaut.dev/#pricing'
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
