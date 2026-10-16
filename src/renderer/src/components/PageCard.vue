<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { PageCardGeometry } from '../../../shared/page-card.js'

// The main process places the pages, so it says where their cards go: one per pane, in shell pixels.
const cards = ref<PageCardGeometry[]>([])
let changedBeforeRead = false
let disposed = false
const unsubscribe = window.hronautPageCard.onChanged((next) => {
  if (disposed) return
  changedBeforeRead = true
  cards.value = next
})
void window.hronautPageCard.get().then((initial) => {
  if (!disposed && !changedBeforeRead) cards.value = initial
}, () => undefined)
onBeforeUnmount(() => {
  disposed = true
  unsubscribe()
})

function px(value: number): string {
  return `${value}px`
}
</script>

<template>
  <div
    v-for="(card, index) in cards"
    :key="index"
    class="page-card"
    data-testid="page-card"
    aria-hidden="true"
    :style="{ left: px(card.x), top: px(card.y), width: px(card.width), height: px(card.height) }"
  />
</template>

<style scoped>
/* The page's native view, rounded to the same radius, covers the inside; only the edge and shadow show. */
.page-card {
  position: fixed;
  z-index: 0;
  pointer-events: none;
  border-radius: var(--page-card-radius);
  box-shadow: var(--page-card-shadow);
}
</style>
