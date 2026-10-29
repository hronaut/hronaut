import {
  WEBMCP_LIMITS,
  webMcpCallScript,
  webMcpDescriptorDigest,
  webMcpListScript,
  webMcpStatusScript,
  type WebMcpPageListing,
  type WebMcpToolDescriptor
} from '../webmcp-bridge.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'

/** Whether the tab's top-level document exposes WebMCP, with the origin and navigation generation it was read from. */
export type WebMcpStatus = {
  supported: boolean
  reason?: string
  tabId: string
  origin: string
  navigationGeneration: number
}

/** The page's WebMCP tools and their descriptor's digest, or why it has none, with the origin and navigation generation they were read from. */
export type WebMcpToolList = {
  supported: boolean
  reason?: string
  status?: string
  tabId: string
  origin: string
  navigationGeneration: number
  descriptorDigest?: string
  tools?: WebMcpToolDescriptor[]
}

/** One call of a listed WebMCP tool, naming the origin, navigation generation and descriptor digest the agent listed it on. */
export type WebMcpToolCall = {
  tabId?: string
  expectedOrigin: string
  navigationGeneration: number
  descriptorDigest: string
  toolName: string
  arguments: Record<string, unknown>
}

/** Reports whether the tab's top-level HTTP(S) document exposes WebMCP. */
export async function webMcpStatus(browser: Browser, tabId?: string): Promise<WebMcpStatus> {
  const tab = getTab(browser, tabId)
  const origin = webMcpHttpOrigin(tab.url)
  const generation = tab.navigationGeneration
  if (!origin) {
    return {
      supported: false,
      reason: 'WebMCP is limited to top-level HTTP(S) documents',
      tabId: tab.id,
      origin: new URL(tab.url).protocol,
      navigationGeneration: generation
    }
  }
  const result = await tab.webContents.executeJavaScript(webMcpStatusScript(), false) as WebMcpPageListing
  requireUnchangedWebMcpTarget(browser, tab.id, tab, origin, generation)
  return {
    supported: result.supported === true,
    ...(result.reason ? { reason: result.reason } : {}),
    tabId: tab.id,
    origin,
    navigationGeneration: generation
  }
}

/** Lists the page's WebMCP tools and remembers their descriptor for later calls on the same document. */
export async function listWebMcpTools(browser: Browser, tabId?: string): Promise<WebMcpToolList> {
  const tab = getTab(browser, tabId)
  const origin = webMcpHttpOrigin(tab.url)
  const generation = tab.navigationGeneration
  if (!origin) return webMcpStatus(browser, tab.id)
  const result = await tab.webContents.executeJavaScript(webMcpListScript(), false) as WebMcpPageListing & {
    status?: string
    error?: string
  }
  requireUnchangedWebMcpTarget(browser, tab.id, tab, origin, generation)
  if (!result.supported || !result.descriptors || !result.descriptorJson) {
    return {
      supported: result.supported === true,
      reason: result.error ?? result.reason ?? result.status ?? 'The page did not return a valid WebMCP descriptor',
      ...(result.status ? { status: result.status } : {}),
      tabId: tab.id,
      origin,
      navigationGeneration: generation
    }
  }
  const descriptorDigest = webMcpDescriptorDigest(result.descriptorJson)
  const key = webMcpDescriptorKey(tab.id, origin, generation, descriptorDigest)
  browser.webMcpDescriptorCache.set(key, result.descriptorJson)
  while (browser.webMcpDescriptorCache.size > 128) {
    const oldest = browser.webMcpDescriptorCache.keys().next().value as string | undefined
    if (!oldest) break
    browser.webMcpDescriptorCache.delete(oldest)
  }
  return {
    supported: true,
    tabId: tab.id,
    origin,
    navigationGeneration: generation,
    descriptorDigest,
    tools: result.descriptors
  }
}

/** Calls one listed WebMCP tool on the unchanged document and reports what changed while it ran. */
export async function callWebMcpTool(browser: Browser, input: WebMcpToolCall): Promise<Record<string, unknown>> {
  const tab = getTab(browser, input.tabId)
  const urlBefore = tab.url
  const origin = webMcpHttpOrigin(tab.url)
  if (!origin || origin !== input.expectedOrigin || tab.navigationGeneration !== input.navigationGeneration) {
    return {
      status: 'STALE_PRECONDITION', dispatch: 'not-dispatched', effects: 'none', retrySafe: true,
      reason: !origin || origin !== input.expectedOrigin ? 'ORIGIN_CHANGED' : 'NAVIGATION_CHANGED'
    }
  }
  const argumentsJson = JSON.stringify(input.arguments)
  if (argumentsJson.length > WEBMCP_LIMITS.maxArgumentsChars) throw new TypeError('WebMCP arguments exceed the 64,000 character limit')
  const descriptorJson = browser.webMcpDescriptorCache.get(webMcpDescriptorKey(
    tab.id, origin, input.navigationGeneration, input.descriptorDigest
  ))
  if (!descriptorJson) {
    return {
      status: 'STALE_DESCRIPTOR', dispatch: 'not-dispatched', effects: 'none', retrySafe: true,
      reason: 'The descriptor was not issued by this Hronaut runtime for the current page'
    }
  }
  let result: Record<string, unknown>
  try {
    result = await tab.webContents.executeJavaScript(webMcpCallScript({
      descriptorJson,
      toolName: input.toolName,
      arguments: input.arguments
    }), false) as Record<string, unknown>
  } catch (error) {
    const current = findTab(browser, tab.id)
    const navigationChanged = !current || current !== tab || current.navigationGeneration !== input.navigationGeneration
      || webMcpHttpOrigin(current.url) !== origin
    return {
      status: navigationChanged ? 'OUTCOME_UNKNOWN' : 'WEBMCP_ERROR',
      dispatch: 'possibly-dispatched',
      effects: 'possible',
      retrySafe: false,
      reason: navigationChanged ? 'NAVIGATION_DURING_EXECUTION' : String(error).slice(0, 500)
    }
  }
  const current = findTab(browser, tab.id)
  const currentOrigin = current ? webMcpHttpOrigin(current.url) : undefined
  const navigationChanged = !current || current !== tab || current.navigationGeneration !== input.navigationGeneration || currentOrigin !== origin
  const observation: Record<string, unknown> = {
    urlBefore,
    originBefore: origin,
    urlAfter: current?.url ?? null,
    originAfter: currentOrigin ?? null,
    navigationChanged,
    navigationGeneration: current?.navigationGeneration ?? null
  }
  if (!navigationChanged && current) {
    try {
      const snapshot = await browser.snapshotDetails(current.id, 8_000)
      observation.snapshot = { formatVersion: snapshot.formatVersion, text: snapshot.text }
    } catch (error) {
      observation.snapshot = { unavailable: true, reason: String(error).slice(0, 300) }
    }
  } else {
    observation.snapshot = { unavailable: true, reason: 'The top-level document changed during execution' }
  }
  return {
    ...result,
    ...(navigationChanged && result.status === 'TOOL_RETURNED'
      ? { status: 'OUTCOME_UNKNOWN', retrySafe: false } : {}),
    observation
  }
}

function webMcpHttpOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

function webMcpDescriptorKey(tabId: string, origin: string, navigationGeneration: number, digest: string): string {
  return `${tabId}\0${origin}\0${navigationGeneration}\0${digest}`
}

function requireUnchangedWebMcpTarget(browser: Browser, tabId: string, expected: BrowserTab, origin: string, generation: number): void {
  const current = findTab(browser, tabId)
  if (!current || current !== expected || current.navigationGeneration !== generation || webMcpHttpOrigin(current.url) !== origin) {
    throw new Error('The top-level page changed while WebMCP tools were being inspected. List them again on the current page.')
  }
}
