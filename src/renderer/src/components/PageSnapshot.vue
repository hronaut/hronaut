<script setup lang="ts">
import { useOcclusionSnapshotController } from '../composables/useOcclusionSnapshotController'

const { snapshot } = useOcclusionSnapshotController(window.hronautShell)
</script>

<template>
  <div v-if="snapshot" class="page-snapshot" data-testid="page-snapshot" aria-hidden="true">
    <img
      v-for="(pane, index) in snapshot.panes"
      :key="index"
      class="page-snapshot-pane"
      :src="pane.image"
      alt=""
      draggable="false"
      :style="{ left: `${pane.bounds.x}px`, top: `${pane.bounds.y}px`, width: `${pane.bounds.width}px`, height: `${pane.bounds.height}px` }"
    >
  </div>
</template>

<style scoped>
/* Sits where the hidden page views were, under every trusted overlay. */
.page-snapshot { position: fixed; inset: 0; z-index: 0; pointer-events: none; user-select: none; }
.page-snapshot-pane { position: absolute; display: block; max-width: none; object-fit: fill; }
</style>
