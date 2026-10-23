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
/** Electron names the profile folder after the app's package name, which is lowercase. */
const PROFILE_FOLDER = 'hronaut'

/**
 * The folder Hronaut keeps its profile in: the one HRONAUT_USER_DATA_DIR names, as Hronaut uses it, or the one
 * Electron gives the Hronaut app on this system.
 */
function profileDirectory(environment = process.env, platform = process.platform, home = homedir()) {
  if (environment.HRONAUT_USER_DATA_DIR) return environment.HRONAUT_USER_DATA_DIR
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', PROFILE_FOLDER)
  if (platform === 'win32') return win32.join(environment.APPDATA || win32.join(home, 'AppData', 'Roaming'), PROFILE_FOLDER)
  return join(environment.XDG_CONFIG_HOME || join(home, '.config'), PROFILE_FOLDER)
}

/** A port Hronaut can listen on; see isValidMcpPort in src/shared/mcp-port.ts. */
function isValidPort(port) {
  return Number.isInteger(port) && port >= 1024 && port <= 65535
}

/**
 * The port Hronaut's MCP server listens on: the one set in the editor, or else the one HRONAUT_MCP_PORT names, as
 * Hronaut uses it, or else its default.
 */
function mcpPort(configured, environment = process.env) {
  if (isValidPort(configured)) return configured
  const fromEnvironment = Number(environment.HRONAUT_MCP_PORT)
  return environment.HRONAUT_MCP_PORT !== undefined && isValidPort(fromEnvironment) ? fromEnvironment : DEFAULT_MCP_PORT
}

/** The address of Hronaut's MCP server on this computer. */
function mcpEndpoint(port) {
  return `http://127.0.0.1:${isValidPort(port) ? port : DEFAULT_MCP_PORT}/mcp`
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

module.exports = { DEFAULT_MCP_PORT, PROFILE_FOLDER, profileDirectory, mcpPort, mcpEndpoint, ownerToken }
