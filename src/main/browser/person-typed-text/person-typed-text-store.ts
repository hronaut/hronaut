import type { Input } from 'electron'
import { redactTypedText, typedTextPattern, typedTexts } from '../../../shared/person-typed-text.js'
import type { BrowserTab } from '../browser-tab.js'

// After the person took a page over from its agent, or signed in where the agent asked them to, what they typed can
// reach the agent later: in a page that shows their email, a request body with their password, a search in an
// address. Hronaut remembers the text they entered then, in memory only, and every result an agent reads in that
// workspace says [redacted] in its place.

/** The most recent texts a workspace keeps; older ones are forgotten first. */
const WORKSPACE_TEXT_LIMIT = 200
/**
 * How long after the person's latest key or click in a page that was theirs a field's value still counts as theirs, for
 * a value the page reports just after they handed it back.
 */
const HELD_INPUT_GRACE_MS = 2_000
/** Keys that type nothing themselves but go on with what the person is typing; any other key that types nothing ends it. */
const RUN_KEEPING_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Dead'])

/** The text the person typed in a tab since the last key that ended it, and the text the workspace keeps for it. */
interface TypingRun {
  workspaceId: string
  text: string
  kept?: string
}

/**
 * Text the person entered in each workspace's pages, as how many times each was entered, newest last, and the
 * pattern that hides them, made again only after they change.
 */
export class PersonTypedText {
  private readonly texts = new Map<string, Map<string, number>>()
  private readonly runs = new Map<string, TypingRun>()
  private readonly patterns = new Map<string, RegExp | null>()
  private readonly heldInputs = new Map<string, number>()

  /** Keeps what the person entered in a page of the workspace, such as a field's value or a password Hronaut filled. */
  remember(workspaceId: string | undefined, values: ReadonlyArray<string | undefined>): void {
    if (!workspaceId) return
    for (const value of values) for (const text of typeof value === 'string' ? typedTexts(value) : []) this.add(workspaceId, text)
  }

  /**
   * A key the person pressed in a tab of the workspace: a character adds to what they are typing, Backspace takes the
   * last one back, and a key that moves the caret or the focus, such as Enter, Tab or an arrow, a shortcut, or a key
   * while the page is not theirs ends it.
   */
  key(tab: Pick<BrowserTab, 'id' | 'mcpGroupId'>, input: Pick<Input, 'key' | 'control' | 'meta' | 'alt'>, held: boolean): void {
    if (held) this.heldInputs.set(tab.id, Date.now())
    const printable = [...input.key].length === 1 && !/\p{Cc}/u.test(input.key) && !input.meta && !(input.control && !input.alt)
    if (!held || !tab.mcpGroupId || (!printable && input.key !== 'Backspace')) {
      // Shift, a dead key or another modifier alone goes on with the text.
      if (!held || !RUN_KEEPING_KEYS.has(input.key)) this.endRun(tab.id)
      return
    }
    let run = this.runs.get(tab.id)
    if (run?.workspaceId !== tab.mcpGroupId) {
      run = { workspaceId: tab.mcpGroupId, text: '' }
      this.runs.set(tab.id, run)
    }
    run.text = input.key === 'Backspace' ? [...run.text].slice(0, -1).join('') : run.text + input.key
    const kept = typedTexts(run.text)[0]
    if (kept === run.kept) return
    if (run.kept) this.remove(run.workspaceId, run.kept)
    if (kept) this.add(run.workspaceId, kept)
    run.kept = kept
  }

  /** The person clicked in a tab: what they type next is another text. */
  pointer(tab: Pick<BrowserTab, 'id'>, held: boolean): void {
    if (held) this.heldInputs.set(tab.id, Date.now())
    this.endRun(tab.id)
  }

  /** The person moved the caret or the focus, or handed the page back: what they type next is another text. */
  endRun(tabId: string): void {
    this.runs.delete(tabId)
  }

  /** Whether the person's latest key or click in the tab came while it was theirs, a moment ago. */
  heldLately(tabId: string, now = Date.now()): boolean {
    const at = this.heldInputs.get(tabId)
    if (at === undefined) return false
    if (now - at < HELD_INPUT_GRACE_MS) return true
    this.heldInputs.delete(tabId)
    return false
  }

  /** The text with what the person entered in these workspaces, or in any when none is named, as [redacted]. */
  redact(text: string, workspaceIds?: readonly string[]): string {
    return redactTypedText(text, this.pattern(workspaceIds))
  }

  /** The pattern for these workspaces' texts, or every workspace's when none is named; null when they keep none. */
  pattern(workspaceIds?: readonly string[]): RegExp | null {
    const ids = workspaceIds ? [...new Set(workspaceIds)].sort() : [...this.texts.keys()].sort()
    const key = workspaceIds ? ids.join('\n') : '*'
    if (!this.patterns.has(key)) this.patterns.set(key, typedTextPattern(ids.flatMap(id => [...this.texts.get(id)?.keys() ?? []])))
    return this.patterns.get(key)!
  }

  private add(workspaceId: string, text: string): void {
    const texts = this.texts.get(workspaceId) ?? new Map<string, number>()
    const count = texts.get(text) ?? 0
    // Entered again, it is the newest.
    texts.delete(text)
    texts.set(text, count + 1)
    while (texts.size > WORKSPACE_TEXT_LIMIT) texts.delete(texts.keys().next().value!)
    this.texts.set(workspaceId, texts)
    this.patterns.clear()
  }

  private remove(workspaceId: string, text: string): void {
    const texts = this.texts.get(workspaceId)
    const count = texts?.get(text)
    if (!texts || count === undefined) return
    if (count > 1) texts.set(text, count - 1)
    else texts.delete(text)
    this.patterns.clear()
  }
}
