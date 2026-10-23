'use strict'

/**
 * Where Hronaut's MCP server listens on this computer and the owner token it asks for, read the way Hronaut itself
 * reads them. Plain Node, so it runs and is tested without the editor.
 */

const { readFile } = require('node:fs/promises')
const { homedir } = require('node:os')
const { join, win32 } = require('node:path')

/** Hronaut's MCP port unless its Settings changed it; see src/shared/mcp-port.ts. */
const DEFAULT_MCP_PORT = 47812
/** Hronaut writes 32 or more URL-safe characters; anything else is not its token and is never sent. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/

/**
 * The folder Hronaut keeps its profile in: the one HRONAUT_USER_DATA_DIR names, as Hronaut uses it, or the one
 * Electron gives the Hronaut app on this system.
 */
function profileDirectory(environment = process.env, platform = process.platform, home = homedir()) {
  if (environment.HRONAUT_USER_DATA_DIR) return environment.HRONAUT_USER_DATA_DIR
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Hronaut')
  if (platform === 'win32') return win32.join(environment.APPDATA || win32.join(home, 'AppData', 'Roaming'), 'Hronaut')
  return join(environment.XDG_CONFIG_HOME || join(home, '.config'), 'Hronaut')
}

/** The address of Hronaut's MCP server on this computer, on the given port or its default one. */
function mcpEndpoint(port) {
  const valid = Number.isInteger(port) && port > 0 && port < 65536
  return `http://127.0.0.1:${valid ? port : DEFAULT_MCP_PORT}/mcp`
}

/**
 * The owner token Hronaut asks for: HRONAUT_MCP_TOKEN, which Hronaut also reads first, or the token file in its
 * profile. Undefined when there is none, such as before Hronaut first ran; Hronaut needs none while its MCP
 * authentication is off.
 */
async function ownerToken(environment = process.env, profile = profileDirectory(environment)) {
  const fromEnvironment = environment.HRONAUT_MCP_TOKEN
  if (fromEnvironment !== undefined) return TOKEN_PATTERN.test(fromEnvironment) ? fromEnvironment : undefined
  try {
    const token = (await readFile(join(profile, 'mcp-token'), 'utf8')).trim()
    return TOKEN_PATTERN.test(token) ? token : undefined
  } catch {
    return undefined
  }
}

module.exports = { DEFAULT_MCP_PORT, profileDirectory, mcpEndpoint, ownerToken }
