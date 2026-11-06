<script setup lang="ts">
import { computed } from 'vue'
import IconLanguage from '~icons/material-symbols/language-rounded'
import { siteIconOrigin } from '../../../shared/site-icons.js'

/** A page's website by the icon a tab last showed for it, as in Chrome's History and Bookmarks, or a globe without one. */
const props = defineProps<{
  url: string
  /** The websites' icons by origin. */
  icons?: Record<string, string>
}>()

const icon = computed(() => {
  const origin = siteIconOrigin(props.url)
  return origin ? props.icons?.[origin] : undefined
})
</script>

<template>
  <img v-if="icon" class="site-icon-image" :src="icon" alt="" draggable="false" />
  <IconLanguage v-else />
</template>
