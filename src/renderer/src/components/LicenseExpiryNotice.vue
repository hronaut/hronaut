<script setup lang="ts">
import type { CommercialLicenseState } from '../../../shared/types.js'
import { useI18n } from 'vue-i18n'
const { t } = useI18n({ useScope: 'global' })
defineProps<{ state: CommercialLicenseState }>()
defineEmits<{ manage: []; purchase: [] }>()
</script>

<template>
  <aside v-if="state.accessAllowed === false && (state.trialStatus === 'expired' || state.status !== 'not-activated')" class="license-expiry-notice" role="status">
    <span>{{ t('licenseNotice.expired') }}</span>
    <button class="ui-button" type="button" @click="$emit('manage')">{{ t('licenseNotice.manage') }}</button>
    <button class="ui-button" type="button" @click="$emit('purchase')">{{ t('licenseNotice.purchase') }}</button>
  </aside>
</template>

<style scoped>
.license-expiry-notice {
  display: flex;
  position: relative;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--toolbar);
  border-top: 1px solid var(--border-soft);
}
:global(.vertical-tabs-shell) .license-expiry-notice { margin-left: var(--tab-rail-width); }
.license-expiry-notice span { flex: 1 1 240px; }
</style>
