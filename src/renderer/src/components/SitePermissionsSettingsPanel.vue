<script setup lang="ts">
import UiIconButton from "../ui/UiIconButton.vue"
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconPrivacy from '~icons/material-symbols/privacy-tip-rounded'
import type { SitePermissionDecision, SitePermissionEntry } from '../../../shared/types'
import type { SitePermissionsController } from '../composables/useSitePermissionsController'

const props = defineProps<{
  controller: SitePermissionsController
}>()

const { t } = useI18n({ useScope: 'global' })
const {
  groups,
  clearing,
  errorMessage,
  permissionLabel,
  isPending,
  setDecision,
  remove
} = props.controller

const panelRoot = ref<HTMLElement | null>(null)

// Track row identity before Vue removes or moves the focused control. The same
// path covers Forget and authoritative permission updates across site groups.
watch(() => groups.value.flatMap(group => group.permissions.map(entry =>
  JSON.stringify([entry.origin, entry.permission])
)).join('\n'), async (_current, _previous, onCleanup) => {
  const panel = panelRoot.value
  const focused = document.activeElement
  if (!panel || !(focused instanceof HTMLElement) || !panel.contains(focused)
    || !focused.matches('select, button.permission-remove')) return
  const row = focused.closest('.permission-row')
  if (!row) return
  const selector = focused.matches('select') ? 'select' : 'button.permission-remove'
  const rows = Array.from(panel.querySelectorAll('.permission-row'))
  const index = rows.indexOf(row)
  const candidates = [...rows.slice(index + 1), ...rows.slice(0, index).reverse()]
    .map(candidate => candidate.querySelector<HTMLElement>(selector))
  let superseded = false
  onCleanup(() => { superseded = true })
  await nextTick()
  if (superseded || panelRoot.value !== panel || !panel.isConnected) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  if (focused.isConnected) {
    if (!focused.matches(':disabled')) focused.focus()
    return
  }
  const target = candidates.find(candidate => candidate?.isConnected
    && !candidate.matches(':disabled, [aria-disabled="true"]'))
    ?? panel.querySelector<HTMLElement>('.setting-copy h3')
  target?.focus()
}, { flush: 'pre' })

async function changePermission(entry: SitePermissionEntry, event: Event): Promise<void> {
  const input = event.target as HTMLSelectElement
  const decision = input.value as SitePermissionDecision
  if (!(await setDecision(entry, decision))) input.value = entry.decision
}
</script>

<template>
  <div ref="panelRoot" class="settings-content permissions-settings">
    <div class="setting-copy">
      <h3 tabindex="-1">{{ t('settings.permissions.heading') }}</h3>
      <p>{{ t('settings.permissions.description') }}</p>
    </div>
    <div v-if="!groups.length" class="site-permissions-empty">
      <span class="empty-permission-icon" aria-hidden="true"><IconPrivacy /></span>
      <strong>{{ t('settings.permissions.emptyHeading') }}</strong>
      <p>{{ t('settings.permissions.emptyDescription') }}</p>
    </div>
    <div v-else class="permission-sites" :aria-busy="clearing">
      <section v-for="group in groups" :key="group.origin" class="permission-site">
        <h4>{{ group.origin }}</h4>
        <div
          v-for="permission in group.permissions"
          :key="permission.permission"
          class="permission-row"
        >
          <span class="permission-name">
            <strong>{{ permissionLabel(permission.permission) }}</strong>
            <small>{{ permission.permission }}</small>
          </span>
          <select
            :value="permission.decision"
            :disabled="clearing || isPending(permission)"
            :aria-label="t('runtimeActions.permission.aria', { permission: permissionLabel(permission.permission), origin: group.origin })"
            @change="changePermission(permission, $event)"
          >
            <option value="allow">{{ t('settings.permissions.allow') }}</option>
            <option value="deny">{{ t('settings.permissions.block') }}</option>
          </select>
          <UiIconButton variant="danger"
            class="permission-remove"
            type="button"
            :label="t('runtimeActions.permission.forgetAria', { permission: permissionLabel(permission.permission), origin: group.origin })"
            :title="t('settings.permissions.forget')"
            :aria-disabled="clearing || isPending(permission)"
            @click="remove(permission)"
          >
            <IconDelete aria-hidden="true" />
          </UiIconButton>
        </div>
      </section>
    </div>
    <output v-if="errorMessage" class="site-controls-error" role="alert">{{ errorMessage }}</output>
    <div class="settings-info">
      <span class="info-dot" aria-hidden="true"><IconInfo /></span>
      <p>{{ t('settings.permissions.help') }}</p>
    </div>
  </div>
</template>
