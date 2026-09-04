import type { Preview } from '@storybook/vue3-vite'
import '../src/renderer/src/styles.css'

const themes = ['light', 'dark', 'midnight', 'sepia', 'cyberpunk', 'matrix', 'machine', 'galactic'] as const

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Hronaut theme',
      toolbar: {
        icon: 'paintbrush',
        items: themes
      }
    }
  },
  initialGlobals: { theme: 'light' },
  decorators: [
    (story, context) => {
      document.documentElement.dataset.theme = String(context.globals.theme ?? 'light')
      return {
        components: { story },
        template: '<div class="storybook-surface"><story /></div>'
      }
    }
  ],
  parameters: {
    a11y: { test: 'error' },
    controls: { expanded: true },
    layout: 'centered'
  }
}

export default preview
