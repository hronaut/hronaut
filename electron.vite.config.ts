import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'

export default defineConfig({
  // electron-vite keeps main and preload dependencies external by default (build.externalizeDeps).
  main: {},
  preload: {
    build: {
      rolldownOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          page: resolve('src/preload/page.ts'),
          addressOverlay: resolve('src/preload/address-overlay.ts'),
          tooltipOverlay: resolve('src/preload/tooltip-overlay.ts'),
          agentCard: resolve('src/preload/agent-card.ts'),
          toastOverlay: resolve('src/preload/toast-overlay.ts'),
          sidebarOverlay: resolve('src/preload/sidebar-overlay.ts'),
          statusBubble: resolve('src/preload/status-bubble.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [tailwindcss(), vue(), Icons({ compiler: 'vue3' })],
    build: {
      manifest: true,
      rolldownOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          videoExport: resolve('src/renderer/video-export.html'),
          videoInspection: resolve('src/renderer/video-inspection.html'),
          home: resolve('src/renderer/src/home.ts'),
          addressOverlay: resolve('src/renderer/address-overlay.html'),
          tooltipOverlay: resolve('src/renderer/tooltip-overlay.html'),
          agentCard: resolve('src/renderer/agent-card.html'),
          toastOverlay: resolve('src/renderer/toast-overlay.html'),
          sidebarOverlay: resolve('src/renderer/sidebar-overlay.html'),
          statusBubble: resolve('src/renderer/status-bubble.html'),
          startupNotice: resolve('src/renderer/startup-notice.html')
        },
        preserveEntrySignatures: 'exports-only'
      }
    }
  }
})
