import type { WebContents } from 'electron'
import type { BrowserState } from '../../../shared/types.js'
import type { ActiveWorkspace } from '../workspace-registry.js'

/**
 * The tab fields the person's input lock reads and writes: the tab's own lock,
 * and the native input environment generation every lock change advances.
 */
export interface InteractionLockTab {
  id: string
  mcpGroupId?: string
  webContents: WebContents
  nativeInputEnvironmentGeneration: number
  humanInteractionLocked: boolean
}

/**
 * What locking the person's page input needs from the tab manager, which
 * keeps the tabs, workspaces, debugger queue, dialog monitoring, the lock
 * mutation queue and counter, the global lock and its unlocked tabs, the
 * native input guard, layout and state publication private. The queue tail,
 * the counter and the global lock stay manager fields because native input,
 * layout and the published browser state read them; they are written back
 * through the write members. Whether a tab is locked and the native input
 * guard stay manager methods because input dispatch and navigation use them
 * too.
 */
export interface InteractionLockAccess<Tab extends InteractionLockTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  tabs(): IterableIterator<Tab>
  findWorkspace(workspaceId: string): Pick<ActiveWorkspace, 'contextClass'> | undefined
  isDestroyed(): boolean
  pendingDebuggerCommand(webContentsId: number): Promise<void> | undefined
  dialogMonitorAttach(webContentsId: number): Promise<void> | undefined
  interactionLockTail(): Promise<void>
  writeInteractionLockTail(tail: Promise<void>): void
  nativeInputLockMutations(): number
  writeNativeInputLockMutations(count: number): void
  allHumanInteractionLocked(): boolean
  writeAllHumanInteractionLocked(locked: boolean): void
  globallyUnlockedTabIds(): Set<string>
  isHumanInteractionLocked(tab: Tab): boolean
  syncHumanInteractionInputGuard(tab: Tab): Promise<void>
  layout(): void
  changed(persist?: boolean): void
  getState(): BrowserState
}
