import type { StorybookConfig } from '@storybook/vue3-vite'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'

const config: StorybookConfig = {
  stories: ['../src/renderer/src/**/*.stories.ts'],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/vue3-vite',
    options: { docgen: 'vue-component-meta' }
  },
  docs: { autodocs: 'tag' },
  viteFinal: (config) => ({
    ...config,
    plugins: [...(config.plugins ?? []), tailwindcss(), vue()]
  })
}

export default config
