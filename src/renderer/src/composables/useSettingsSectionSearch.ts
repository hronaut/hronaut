import { computed, ref, type Component, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SettingsSection } from './useSettingsDialogController.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'

/**
 * How well a section's text holds every searched word: 0 when its name or description has them all, 1 when the words
 * for its settings complete them, 2 when a word is only there in another form, and undefined when one is missing. A
 * word of five letters or more matches another form of itself, a word in the text that starts the same but ends
 * differently, so "ключ лицензии" finds "лицензия" and "обновить" finds "обновление". "ё" counts as "е", as people
 * type it either way.
 */
function matchRank(name: string, text: string, searched: string[]): number | undefined {
  if (searched.every(word => name.includes(word))) return 0
  if (searched.every(word => text.includes(word))) return 1
  const words = text.split(/[^\p{L}\p{N}]+/u)
  const inAnyForm = (word: string) => {
    if (text.includes(word)) return true
    if (word.length < 5) return false
    const stem = word.slice(0, Math.max(4, word.length - (word.length >= 7 ? 3 : 2)))
    return words.some(candidate => candidate.startsWith(stem))
  }
  return searched.every(inAnyForm) ? 2 : undefined
}

/**
 * Finds sections by name, description, or the words for the settings they hold, such as "tray" for Appearance. The
 * sections that match best come first, in their usual order, so Enter opens the section named by the search.
 */
export function useSettingsSectionSearch(items: Ref<Array<{ section: SettingsSection; label: string; description: string; keywords?: string; icon: Component }>>, section: Ref<SettingsSection>) {
  const { locale } = useI18n({ useScope: 'global' })
  const query = ref('')
  const normalize = (value: string) => value.toLocaleLowerCase(locale.value).replaceAll('ё', 'е')
  const matches = computed(() => {
    const searched = normalize(query.value.trim()).split(/\s+/)
    return items.value
      .map(item => {
        const name = normalize(`${item.label} ${item.description}`)
        return { item, rank: matchRank(name, `${name} ${normalize(item.keywords ?? '')}`, searched) }
      })
      .filter((match): match is { item: typeof match.item; rank: number } => match.rank !== undefined)
      .sort((first, second) => first.rank - second.rank)
      .map(match => match.item)
  })

  function searchKeydown(event: KeyboardEvent): void {
    if (isImeCompositionEvent(event)) return
    if (event.key === 'Escape' && query.value) {
      event.stopPropagation()
      query.value = ''
    } else if (event.key === 'Enter' && matches.value[0]) {
      event.preventDefault()
      section.value = matches.value[0].section
    }
  }

  return { query, matches, searchKeydown }
}
