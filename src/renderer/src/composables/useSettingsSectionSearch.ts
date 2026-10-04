import { computed, ref, type Component, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SettingsSection } from './useSettingsDialogController.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'

export function useSettingsSectionSearch(items: Ref<Array<{ section: SettingsSection; label: string; description: string; icon: Component }>>, section: Ref<SettingsSection>) {
  const { locale } = useI18n({ useScope: 'global' })
  const query = ref('')
  const matches = computed(() => {
    const words = query.value.trim().toLocaleLowerCase(locale.value).split(/\s+/)
    return items.value
      .filter(item => words.every(word => `${item.label} ${item.description}`.toLocaleLowerCase(locale.value).includes(word)))
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
