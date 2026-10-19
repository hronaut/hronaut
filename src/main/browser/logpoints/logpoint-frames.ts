import type { CdpSend } from './logpoint-sources.js'

export interface FrameTreeNode {
  frame: { id: string; url: string; securityOrigin?: string }
  childFrames?: FrameTreeNode[]
}

/** The page's frames as one check sees them: the top-level frame, and every frame on the page's origin. */
export interface PageFrames {
  mainFrameId: string
  frames: Set<string>
}

/** Frames of one page searched for scripts on its origin. */
const MAX_FRAMES = 1_000
/**
 * Whether a paused frame's global object is the top-level window. Both are unforgeable properties of a
 * window, so page code cannot change the answer, and reading them has no side effect.
 */
const IS_TOP_WINDOW = 'function () { return this.window === this.top }'

export function httpOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

/** The page's frame tree as Chromium reports it now, from the top-level frame. */
export async function topFrame(send: CdpSend): Promise<FrameTreeNode> {
  return (await send<{ frameTree: FrameTreeNode }>('Page.getFrameTree')).frameTree
}

/**
 * The top-level frame and the page's frames on its origin, once the top-level address is checked to still
 * be on it. A script compiled before the Debugger domain was enabled can be shared by same-origin frames
 * and reported for any one of them, so their scripts are the page's candidates too.
 */
export async function pageFrames(send: CdpSend, origin: string): Promise<PageFrames> {
  const tree = await topFrame(send)
  if (httpOrigin(tree.frame.url) !== origin) throw new Error('The page changed while setting up logpoints. Try again on the current page.')
  const frames = new Set<string>()
  const pending: FrameTreeNode[] = [tree]
  for (let node = pending.shift(); node && frames.size < MAX_FRAMES; node = pending.shift()) {
    if (node === tree || (node.frame.securityOrigin ?? httpOrigin(node.frame.url)) === origin) frames.add(node.frame.id)
    pending.push(...(node.childFrames ?? []))
  }
  return { mainFrameId: tree.frame.id, frames }
}

/**
 * Whether a paused call frame runs in the top-level document, asked of its own global object: one script
 * can be shared by several frames, so the script alone does not say. Undefined when it cannot be asked.
 */
export async function pausedInTopFrame(send: CdpSend, globalObjectId: string | undefined): Promise<boolean | undefined> {
  if (!globalObjectId) return undefined
  return send<{ result?: { value?: unknown }; exceptionDetails?: unknown }>('Runtime.callFunctionOn', {
    objectId: globalObjectId, functionDeclaration: IS_TOP_WINDOW, returnByValue: true, silent: true, throwOnSideEffect: true
  }).then(answer => answer.exceptionDetails || typeof answer.result?.value !== 'boolean' ? undefined : answer.result.value, () => undefined)
}
