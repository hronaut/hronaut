import { computed, ref, type Component, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SettingsSection } from './useSettingsDialogController.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'

/**
 * Whether a searched word is in a section's text. A word of five letters or more also matches another form of itself,
 * a word in the text that starts the same but ends differently, so "ключ лицензии" finds "лицензия", "обновить" finds
 * "обновление" and "passwords" finds "password". "ё" counts as "е", as people type it either way.
 */
function textHasWord(text: string, words: string[], word: string): boolean {
  if (text.includes(word)) return true
  if (word.length < 5) return false
  const stem = word.slice(0, Math.max(4, word.length - (word.length >= 7 ? 3 : 2)))
  return words.some(candidate => candidate.startsWith(stem))
}

/** Finds sections by name, description, or the words for the settings they hold, such as "tray" for Appearance. */
export function useSettingsSectionSearch(items: Ref<Array<{ section: SettingsSection; label: string; description: string; keywords?: string; icon: Component }>>, section: Ref<SettingsSection>) {
  const { locale } = useI18n({ useScope: 'global' })
  const query = ref('')
  const normalize = (value: string) => value.toLocaleLowerCase(locale.value).replaceAll('ё', 'е')
  const matches = computed(() => {
    const searched = normalize(query.value.trim()).split(/\s+/)
    return items.value.filter(item => {
      const text = normalize(`${item.label} ${item.description} ${item.keywords ?? ''}`)
      const words = text.split(/[^\p{L}\p{N}]+/u)
      return searched.every(word => textHasWord(text, words, word))
    })
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
