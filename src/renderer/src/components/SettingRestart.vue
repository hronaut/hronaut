<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import UiButton from '../ui/UiButton.vue'

/**
 * Under a setting whose change applies at the next start: the notice that asks for a restart, and Restart beside it,
 * as Chrome's Relaunch beside graphics acceleration. The live region stays in place, so screen readers announce the
 * notice when a change brings it.
 */
const props = defineProps<{
  required: boolean
  message: string
}>()

const { t } = useI18n({ useScope: 'global' })

// Main first asks about downloads in progress, as Quit does, and restarts only once however often this is pressed.
// When the downloads are kept, or the restart fails, Hronaut stays open and so does the notice.
async function restart(): Promise<void> {
  try {
    await window.hronautSettings.restart()
  } catch (error) {
    console.error('[settings] Could not restart Hronaut:', error)
  }
}
</script>

<template>
  <div class="setting-restart">
    <span role="status">
      <small v-if="props.required" class="setting-restart-required">{{ props.message }}</small>
    </span>
    <UiButton v-if="props.required" class="secondary-button" type="button" @click="restart">
      {{ t('settings.restartNow') }}
    </UiButton>
  </div>
</template>
