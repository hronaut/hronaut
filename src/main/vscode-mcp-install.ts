interface VsCodeMcpInstallOptions {
  endpoint: string
  authenticationEnabled: boolean
  openExternal: (url: string) => Promise<void>
}

function validatedLoopbackEndpoint(endpoint: string): string {
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    throw new TypeError('VS Code installation requires a credential-free loopback MCP endpoint.')
  }
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
  const validPort = /^\d{1,5}$/.test(parsed.port)
    && Number(parsed.port) >= 1
    && Number(parsed.port) <= 65_535
  if (
    parsed.protocol !== 'http:'
    || !loopbackHosts.has(parsed.hostname)
    || parsed.pathname !== '/mcp'
    || !validPort
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new TypeError('VS Code installation requires a credential-free loopback MCP endpoint.')
  }
  return parsed.toString()
}

export function createVsCodeMcpInstallUri(endpoint: string): string {
  const configuration = {
    name: 'hronaut',
    type: 'http',
    url: validatedLoopbackEndpoint(endpoint)
  }
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(configuration))}`
}

export async function openVsCodeMcpInstall(options: VsCodeMcpInstallOptions): Promise<void> {
  if (options.authenticationEnabled) {
    throw new Error('One-click VS Code setup is unavailable while MCP authentication is enabled. Use the manual setup instead.')
  }
  await options.openExternal(createVsCodeMcpInstallUri(options.endpoint))
}
