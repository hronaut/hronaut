'use strict'

/**
 * Registers Hronaut's MCP server with the editor, so its agents, such as GitHub Copilot's agent mode, can use Hronaut
 * without an mcp.json entry. The owner token is read when the editor starts the server, never stored in settings.
 */

const { mcpEndpoint, ownerToken } = require('./connection.js')

const PROVIDER_ID = 'hronaut'
const LABEL = 'Hronaut'

/** The provider for the editor's `vscode` API; separate from `activate` so it is tested without the editor. */
function createProvider(vscode, version, readToken = ownerToken) {
  const changed = new vscode.EventEmitter()
  const port = () => vscode.workspace.getConfiguration('hronaut').get('mcpPort')
  const provider = {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions: () => [new vscode.McpHttpServerDefinition(LABEL, vscode.Uri.parse(mcpEndpoint(port())), {}, version)],
    async resolveMcpServerDefinition(server) {
      const token = await readToken()
      if (token) server.headers = { ...server.headers, Authorization: `Bearer ${token}` }
      return server
    }
  }
  const watch = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('hronaut.mcpPort')) changed.fire()
  })
  return { provider, dispose: () => { watch.dispose(); changed.dispose() } }
}

function activate(context) {
  const vscode = require('vscode')
  const { provider, dispose } = createProvider(vscode, context.extension.packageJSON.version)
  context.subscriptions.push({ dispose }, vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, provider))
}

function deactivate() {}

module.exports = { activate, deactivate, createProvider }
