// Names for the request-condition failure reasons in BROWSER_NETWORK_ABORT_REASONS
// (src/shared/types/console-network.ts), keyed by Chromium's code.
export const enUSNetworkAbortReasons = {
  Aborted: 'Aborted',
  Failed: 'Generic failure',
  TimedOut: 'Timed out',
  AccessDenied: 'Access denied',
  ConnectionClosed: 'Connection closed',
  ConnectionReset: 'Connection reset',
  ConnectionRefused: 'Connection refused',
  ConnectionFailed: 'Connection failed',
  NameNotResolved: 'Host name not resolved',
  InternetDisconnected: 'Internet disconnected',
  AddressUnreachable: 'Address unreachable',
  BlockedByClient: 'Blocked by client',
  BlockedByResponse: 'Blocked by response'
}
