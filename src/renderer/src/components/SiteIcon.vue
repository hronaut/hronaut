<script setup lang="ts">
import { computed } from 'vue'
import IconLanguage from '~icons/material-symbols/language-rounded'
import { siteIconOrigin, type SiteIconIndex } from '../../../shared/site-icons.js'
import { normalizeHistoryUrl } from '../../../shared/visit-history.js'

/**
 * A page's icon as a tab showed it, or its website's for a page no tab showed one for since, as in Chrome's History and
 * Bookmarks, or a globe without one.
 */
const props = defineProps<{
  url: string
  /** The icons tabs showed for the pages. */
  icons?: SiteIconIndex
}>()

// Read from the address only when it changes, not each time an icon does.
const page = computed(() => normalizeHistoryUrl(props.url))
const origin = computed(() => siteIconOrigin(props.url))
const icon = computed(() => props.icons?.iconFor(page.value, origin.value))
</script>

<template>
  <img v-if="icon" class="site-icon-image" :src="icon" alt="" draggable="false" />
  <IconLanguage v-else />
</template>
