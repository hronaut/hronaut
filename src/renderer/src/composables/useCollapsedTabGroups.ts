import { ref } from 'vue'
import { readLocalPreference, writeLocalPreference } from '../local-preferences.js'

/** The workspace groups the person folded in the tab strip or rail, remembered in this profile's local preferences. */
export function useCollapsedTabGroups() {
  const collapsedTabGroupIds = ref(new Set<string>(loadCollapsedTabGroupIds()))

  function isTabGroupCollapsed(groupId: string): boolean {
    return collapsedTabGroupIds.value.has(groupId)
  }

  function persistCollapsedTabGroups(): void {
    writeLocalPreference('hronaut:collapsed-tab-groups', JSON.stringify([...collapsedTabGroupIds.value]))
  }

  function toggleTabGroup(groupId: string): void {
    const next = new Set(collapsedTabGroupIds.value)
    if (next.has(groupId)) next.delete(groupId)
    else next.add(groupId)
    collapsedTabGroupIds.value = next
    persistCollapsedTabGroups()
  }

  function expandTabGroup(groupId: string): void {
    if (!collapsedTabGroupIds.value.has(groupId)) return
    const next = new Set(collapsedTabGroupIds.value)
    next.delete(groupId)
    collapsedTabGroupIds.value = next
    persistCollapsedTabGroups()
  }

  /** Forgets folded groups whose workspace no longer exists. */
  function forgetMissingTabGroups(groupIds: readonly string[]): void {
    const validGroupIds = new Set(groupIds)
    const next = new Set([...collapsedTabGroupIds.value].filter((groupId) => validGroupIds.has(groupId)))
    if (next.size === collapsedTabGroupIds.value.size) return
    collapsedTabGroupIds.value = next
    persistCollapsedTabGroups()
  }

  return { collapsedTabGroupIds, isTabGroupCollapsed, toggleTabGroup, expandTabGroup, forgetMissingTabGroups }
}

function loadCollapsedTabGroupIds(): string[] {
  try {
    const stored: unknown = JSON.parse(readLocalPreference('hronaut:collapsed-tab-groups') ?? '[]')
    return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}
