import { describe, expect, it } from 'vitest'
import type { WebContents } from 'electron'
import { shadowSnapshot } from '../src/main/browser/shadow-snapshot/shadow-snapshot.js'
import type { ShadowSnapshotAccess, ShadowSnapshotTab } from '../src/main/browser/shadow-snapshot/shadow-snapshot-access.js'
import type { BrowserSnapshotDeltaContext } from '../src/shared/snapshot-delta.js'

const CONTEXT: BrowserSnapshotDeltaContext = { tabId: 'tab-1', workspaceId: 'workspace-1', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0, snapshotFormatVersion: 1 }

/** A tab whose page answers the shadow snapshot script with the given value, and the scripts it was sent. */
function fakePage(answer: unknown, during?: () => void) {
  const scripts: Array<{ world: number; code: string }> = []
  const webContents = {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: async (world: number, sources: Array<{ code: string }>) => {
      scripts.push({ world, code: sources[0]!.code })
      during?.()
      return answer
    }
  } as unknown as WebContents
  const tab: ShadowSnapshotTab = { id: 'tab-1', webContents }
  let current: ShadowSnapshotTab | undefined = tab
  let context = CONTEXT
  const access: ShadowSnapshotAccess<ShadowSnapshotTab> = {
    getTab: () => tab,
    findTab: () => current,
    snapshotDeltaContext: () => context
  }
  return {
    access,
    scripts,
    replaceTab: () => { current = { id: 'tab-1', webContents } },
    navigate: () => { context = { ...context, navigationGeneration: context.navigationGeneration + 1 } }
  }
}

const PAGE = { hostTag: 'x-card', text: 'SCOPE: open shadow root of <x-card>\nTEXT: Hello', omissions: ['private-editors', 'frames'], shadowRoots: 2, assignedSlots: 3 }

describe('shadowSnapshot', () => {
  it('returns a fresh read-only capture in the shadow snapshot world, complete but without proof of absence when private content was left out', async () => {
    const page = fakePage(PAGE)
    const first = await shadowSnapshot(page.access, 'tab-1', '#card', 10)
    expect(first).toMatchObject({
      kind: 'shadow-observation',
      formatVersion: 1,
      scope: { kind: 'open-shadow-root', hostTag: 'x-card', refs: false, outsideScopeOmitted: true },
      text: PAGE.text,
      untrusted: true,
      completeness: { complete: true, omissions: ['frames', 'private-editors'], absenceNotEstablished: true },
      coverage: { shadowRoots: 2, assignedSlots: 3 },
      limits: { nodes: 10_000, depth: 100, durationMs: 500, headings: 80, controls: 500, maxChars: 1_000 }
    })
    expect(page.scripts[0]!.world).toBe(1026)
    expect(page.scripts[0]!.code).toContain('const MAX_CHARS = 1000;')
    expect(page.scripts[0]!.code).toContain('document.querySelectorAll("#card")')
    const second = await shadowSnapshot(page.access, 'tab-1', '#card')
    expect(second.captureId).not.toBe(first.captureId)
    expect(second.limits.maxChars).toBe(30_000)
  })

  it('establishes absence only when nothing was left out', async () => {
    const capture = await shadowSnapshot(fakePage({ ...PAGE, omissions: [] }).access, 'tab-1', '#card')
    expect(capture.completeness).toEqual({ complete: true, omissions: [], absenceNotEstablished: false })
  })

  it.each(['node-limit', 'depth-limit', 'duration-limit', 'heading-limit', 'control-limit', 'text-limit'])('marks a capture stopped by %s incomplete, so it cannot show that a control is absent', async (omission) => {
    const capture = await shadowSnapshot(fakePage({ ...PAGE, omissions: [omission, 'unknown-reason'] }).access, 'tab-1', '#card')
    expect(capture.completeness).toEqual({ complete: false, omissions: [omission], absenceNotEstablished: true })
  })

  it.each([
    ['invalid-selector', /not valid CSS/],
    ['missing-host', /not found in the top-level page; selectors do not reach into shadow roots/],
    ['ambiguous-host', /exactly one element/],
    ['no-open-shadow-root', /no open shadow root; closed shadow roots and the built-in ones/],
    ['editable-host', /inside editable content/],
    ['hidden-host', /not rendered or not visible/]
  ])('refuses a host the page reports as %s', async (problem, message) => {
    await expect(shadowSnapshot(fakePage({ problem }).access, 'tab-1', '#card')).rejects.toThrow(message)
  })

  it('refuses an empty or overlong selector before the page sees it', async () => {
    const page = fakePage(PAGE)
    await expect(shadowSnapshot(page.access, 'tab-1', '   ')).rejects.toThrow(TypeError)
    await expect(shadowSnapshot(page.access, 'tab-1', 'x'.repeat(513))).rejects.toThrow(/at most 512 characters/)
    expect(page.scripts).toHaveLength(0)
  })

  it('discards a capture when the tab was replaced or navigated while the page answered', async () => {
    const replaced = fakePage(PAGE, () => replaced.replaceTab())
    await expect(shadowSnapshot(replaced.access, 'tab-1', '#card')).rejects.toThrow(/tab changed while it was being observed/)
    const navigated = fakePage(PAGE, () => navigated.navigate())
    await expect(shadowSnapshot(navigated.access, 'tab-1', '#card')).rejects.toThrow(/context changed during observation \(navigation\)/)
  })
})
