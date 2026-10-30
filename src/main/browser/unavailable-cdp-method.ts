/** Whether a DevTools protocol error says this Chromium build has no such method. */
export function isUnavailableCdpMethod(error: unknown): boolean {
  return /(?:method not found|wasn't found|-32601)/i.test(String(error))
}
