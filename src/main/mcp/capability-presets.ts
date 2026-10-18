import { BROWSER_TOOL_CATALOG, mcpToolCatalogForSet } from './tool-catalog.js'
import { MCP_CAPABILITY_OPERATION_CLASSES, mcpCapabilityArgumentValueDigest, type McpCapabilityProfileInput } from './capability-profile-store.js'
import type { McpCapabilityProfileCreateInput } from '../../shared/types.js'
import { READ_ONLY_MULTI_ACTIONS } from './capability-classification.js'
import { MCP_REQUIRED_ARGUMENT_CONSTRAINTS } from './capability-profile-contracts.js'

/** Turns a capability profile preset chosen in the shell into the profile the capability store saves. */
export function mcpCapabilityProfileInputFromPreset(
  input: McpCapabilityProfileCreateInput,
  now = new Date()
): McpCapabilityProfileInput {
  if (!['read-only', 'essentials', 'qa', 'complete'].includes(input.preset)) {
    throw new TypeError('Unsupported MCP capability profile preset')
  }
  if (input.expiresInMinutes !== undefined && (!Number.isSafeInteger(input.expiresInMinutes)
    || input.expiresInMinutes < 1 || input.expiresInMinutes > 43_200)) {
    throw new TypeError('MCP capability profile expiry must be between 1 minute and 30 days')
  }
  const catalog = input.preset === 'read-only'
    ? BROWSER_TOOL_CATALOG.filter(tool => !tool.name.startsWith('wallet_')
      && (tool.annotations.readOnlyHint || READ_ONLY_MULTI_ACTIONS[tool.name]))
    : mcpToolCatalogForSet(input.preset)
  const allowedActions = input.preset === 'read-only'
    ? Object.fromEntries(catalog.flatMap(tool => {
        const actions = READ_ONLY_MULTI_ACTIONS[tool.name]
        return actions ? [[tool.name, [...actions]]] : []
      }))
    : undefined
  const argumentValueDigests = input.argumentConstraints
    ? Object.fromEntries(Object.entries(input.argumentConstraints).map(([path, values]) => [
        path,
        values.map(mcpCapabilityArgumentValueDigest)
      ]))
    : undefined
  return {
    name: input.name,
    allowedTools: catalog.filter(tool => !MCP_REQUIRED_ARGUMENT_CONSTRAINTS[tool.name]
      || input.preset !== 'read-only' && !!argumentValueDigests?.[MCP_REQUIRED_ARGUMENT_CONSTRAINTS[tool.name]!.path]?.length).map(tool => tool.name),
    ...(allowedActions && Object.keys(allowedActions).length ? { allowedActions } : {}),
    operationClasses: input.preset === 'read-only' ? ['read'] : [...MCP_CAPABILITY_OPERATION_CLASSES],
    ...(input.workspaceIds ? { workspaceIds: input.workspaceIds } : {}),
    ...(input.origins ? { origins: input.origins } : {}),
    ...(argumentValueDigests && Object.keys(argumentValueDigests).length ? { argumentValueDigests } : {}),
    ...(input.expiresInMinutes !== undefined
      ? { expiresAt: new Date(now.getTime() + input.expiresInMinutes * 60_000).toISOString() }
      : {}),
    ...(input.singleUse ? { maxUses: 1 } : {})
  }
}
