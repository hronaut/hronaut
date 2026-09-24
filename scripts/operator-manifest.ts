import { writeFile } from 'node:fs/promises'
import { isMainModule } from './is-main-module.ts'
import {
  BROWSER_SERVER_INSTRUCTIONS,
  BROWSER_TOOL_CATALOG,
  mcpToolCatalogForSet
} from '../src/main/mcp/server.ts'
import { MCP_TOOL_SETS } from '../src/shared/mcp-tool-sets.ts'

export const OPERATOR_MANIFEST_SCHEMA_VERSION = '1.0'

export function generateOperatorManifest(version: string) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new TypeError('Operator manifest requires a semantic Hronaut version')
  }

  return {
    schemaVersion: OPERATOR_MANIFEST_SCHEMA_VERSION,
    hronautVersion: version,
    kind: 'hronaut-operator-contract',
    informationalOnly: true,
    interfaces: {
      desktop: {
        platforms: ['darwin', 'win32', 'linux'],
        visible: true,
        persistentWorkspaces: true
      },
      mcp: {
        protocol: 'Model Context Protocol',
        transport: 'streamable-http',
        networkScope: 'loopback-only',
        stdioAdapterArtifact: `hronaut-mcp-adapter-${version}.mcpb`,
        optionalBearerAuthentication: true,
        endpointAndCredentialsIncluded: false
      }
    },
    prerequisites: [
      'Install and start the matching Hronaut desktop release.',
      'Read the local loopback endpoint and optional authentication token from trusted Hronaut Home.',
      'Create a fresh named task workspace before using page tools, or explicitly resume an owned workspace with its private resume capability.',
      'Keep sign-in, account selection, two-factor authentication, and consequential approvals visible to the person.'
    ],
    context: {
      bindAuthorityTo: ['mcp-session', 'workspace', 'profile', 'account', 'origin', 'tab', 'policy-revision'],
      revalidateAfter: ['navigation', 'reconnect', 'workspace-change', 'profile-change', 'account-change', 'origin-change', 'tab-change', 'policy-change', 'human-input'],
      manifestDoesNotGrantAuthority: true,
      toolAvailabilityDoesNotGrantAuthority: true
    },
    humanTakeover: {
      visibleBrowserIsAuthoritative: true,
      showWithoutFocusTool: 'browser_show',
      requestAttentionTool: 'browser_request_user_attention',
      requiredWhen: ['sign-in', 'two-factor-authentication', 'identity-unclear', 'target-unclear', 'consequential-approval'],
      agentCannotApproveItsOwnWalletRequest: true
    },
    privacy: {
      boundedOutputs: true,
      redactedByDefault: true,
      excluded: ['credentials', 'authentication-tokens', 'cookie-values', 'live-form-values', 'raw-page-source', 'private-account-identifiers'],
      privateResumeCapabilitiesMustNotEnterWebsiteContent: true
    },
    resultStates: {
      unsupported: 'The matching interface or operation is unavailable; no action or postcondition is claimed.',
      blocked: 'Policy, capability, context, or a human gate prevented dispatch; no postcondition is claimed.',
      unknown: 'Dispatch or its side effect may have occurred, but authoritative read-back is unavailable or inconclusive.',
      reconciliation_required: 'A possible side effect must be checked in fresh context before retry or success classification.',
      verified: 'A bounded independent read-back from the target system matches the expected postcondition.'
    },
    forwardCompatibility: {
      unknownResultStatesMustRemainUnverified: true,
      unknownToolsMustNotBeInvoked: true,
      newerSchemaRequiresCompatibleReader: true
    },
    operationFlow: [
      { step: 'establish-context', evidence: ['matching-version', 'mcp-session', 'named-workspace', 'profile', 'account-if-relevant', 'origin', 'tab'] },
      { step: 'observe', evidence: ['fresh-bounded-observation', 'current-policy-and-capability'] },
      { step: 'request-or-dispatch', evidence: ['exact-operation', 'target', 'human-gate-if-required', 'transport-result'] },
      { step: 'read-back', evidence: ['independent-authoritative-postcondition'] },
      { step: 'classify', evidence: ['result-state', 'fresh-context-or-invalidation-reason'] }
    ],
    retry: {
      transportAcknowledgementIsVerification: false,
      blindRetryAfterUnknown: false,
      requireFreshObservationAfterInvalidation: true,
      requireReadBackBeforeRetryingPossibleSideEffect: true
    },
    serverInstructions: BROWSER_SERVER_INSTRUCTIONS,
    toolSets: Object.fromEntries(MCP_TOOL_SETS.map((toolSet) => [
      toolSet,
      mcpToolCatalogForSet(toolSet).map(({ name }) => name)
    ])),
    tools: BROWSER_TOOL_CATALOG.map(({ name, title, category, annotations }) => ({
      name,
      title,
      category,
      annotations
    }))
  }
}

if (isMainModule(import.meta.url)) {
  const [version, outputPath] = process.argv.slice(2)
  if (!version || !outputPath) throw new Error('Usage: node scripts/operator-manifest.ts VERSION OUTPUT_JSON')
  await writeFile(outputPath, `${JSON.stringify(generateOperatorManifest(version), null, 2)}\n`)
}
