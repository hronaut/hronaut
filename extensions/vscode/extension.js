'use strict'

/**
 * Registers Hronaut's MCP server with the editor, so its agents, such as GitHub Copilot's agent mode, can use Hronaut
 * without an mcp.json entry. The owner token is read when the editor starts the server, never stored in settings.
 */

const { mcpEndpoint, mcpPort, ownerToken } = require('./connection.js')

const PROVIDER_ID = 'hronaut'
const LABEL = 'Hronaut'

/** The provider for the editor's `vscode` API; separate from `activate` so it is tested without the editor. */
function createProvider(vscode, version, readToken = ownerToken, environment = process.env) {
  const changed = new vscode.EventEmitter()
  // Only a port set in the user's own settings counts, which the setting's application scope keeps to this computer.
  const port = () => mcpPort(vscode.workspace.getConfiguration('hronaut').inspect('mcpPort')?.globalValue, environment)
  const provider = {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions: () => [new vscode.McpHttpServerDefinition(LABEL, vscode.Uri.parse(mcpEndpoint(port())), {}, version)],
    async resolveMcpServerDefinition(server) {
      // The editor passes the same definition on every start, so a token from an earlier start must not stay on it.
      const token = await readToken()
      server.headers = token ? { Authorization: `Bearer ${token}` } : {}
      return server
    }
  }
  const watch = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('hronaut.mcpPort')) changed.fire()
  })
  return { provider, dispose: () => { watch.dispose(); changed.dispose() } }
}

function activate(context, vscode = require('vscode')) {
  // Some editors built on VS Code accept the extension without letting extensions add MCP servers.
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== 'function') {
    void vscode.window.showWarningMessage('This editor does not let extensions add MCP servers. Add Hronaut from Hronaut Home instead.')
    return
  }
  const { provider, dispose } = createProvider(vscode, context.extension.packageJSON.version)
  context.subscriptions.push({ dispose })
  context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, provider))
}

function deactivate() {}

module.exports = { activate, deactivate, createProvider }
