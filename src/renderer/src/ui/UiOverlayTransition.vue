<script setup lang="ts">
import { overlayTransitionHooks } from '../composables/overlay-motion.js'
</script>

<template>
  <!-- Full-window overlays: the entrance plays from motion.css, the exit holds the page hidden until it ends. -->
  <Transition name="ui-overlay" v-bind="overlayTransitionHooks"><slot /></Transition>
</template>
