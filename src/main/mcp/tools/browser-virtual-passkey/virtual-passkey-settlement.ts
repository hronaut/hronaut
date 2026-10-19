import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { textResult } from '../../tool-results.js'

const SEPARATE_GRANT_REQUIRED = {
  status: 'REFUSED',
  reason: 'SEPARATE_GRANT_REQUIRED',
  dispatch: 'not-dispatched',
  effects: 'none',
  nextAction: 'Virtual passkeys need a capability credential whose profile lists the exact localhost origins. Ask the person to create one in Settings → MCP security with the argument constraint browser_virtual_passkey.origin set to each origin, such as http://localhost:3000; full-access credentials cannot use virtual passkeys.'
}

/**
 * How a virtual passkey call is admitted: only a capability credential reaches it, so the person names the
 * origins an authenticator may serve, and the shared capability check refuses any profile without that constraint.
 * Full access is refused before anything else.
 */
export function virtualPasskeySettlement(hasCapability: boolean) {
  return {
    admit: (): CallToolResult | undefined => hasCapability
      ? undefined
      : { ...textResult(SEPARATE_GRANT_REQUIRED), structuredContent: SEPARATE_GRANT_REQUIRED, isError: true }
  }
}

export type VirtualPasskeySettlement = ReturnType<typeof virtualPasskeySettlement>
