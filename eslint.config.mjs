import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import promise from 'eslint-plugin-promise'
import vueI18n from '@intlify/eslint-plugin-vue-i18n'

const sourceFiles = [
  'src/**/*.{ts,vue}', 'tests/**/*.ts', 'scripts/**/*.ts', 'website/**/*.ts', '*.config.ts'
]
const newBoundaryFiles = [
  'src/shared/{locale,i18n}.ts',
  'src/shared/locales/**/*.ts',
  'src/main/settings-store.ts',
  'src/renderer/src/i18n.ts',
  'src/renderer/src/stores/**/*.ts',
  'src/renderer/src/composables/**/*.ts',
  'src/renderer/src/components/**/*.vue',
  'tests/renderer/**/*.ts'
]
const exactTechnicalText = '^(?:\\s*|Hronaut|MCP|GitHub|PolyForm Noncommercial 1\\.0\\.0|IndexedDB|JS|CSS|GET|POST|PUT|PATCH|DELETE|OPTIONS|https://api\\.example\\.com/v1/\\*|\\{\"content-type\":\"application/json\"\\}|\\{\"ok\":false\\}|/ 255|0 / 0|· v|[.:+›↑↓←→·—↗%✦×]+|:\\d+)$'

export default defineConfig(
  {
    ignores: [
      'node_modules/**', 'out/**', 'dist/**', 'docs/assets/**', 'release/**', 'coverage/**',
      'playwright-report/**', 'storybook-static/**', 'test-results/**', 'scripts/mcp-workspace.js', '*.config.*.mjs'
    ]
  },
  {
    files: sourceFiles,
    extends: [js.configs.recommended, ...tseslint.configs.recommended, promise.configs['flat/recommended']],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { tsconfigRootDir: import.meta.dirname }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'promise/always-return': 'off',
      'promise/catch-or-return': 'off',
      'promise/no-nesting': 'off',
      'promise/param-names': 'off',
      // Legacy Electron wrappers intentionally replace low-level errors with bounded user-safe messages.
      'preserve-caught-error': 'off'
    }
  },
  {
    files: newBoundaryFiles,
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname, extraFileExtensions: ['.vue'] }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/require-await': 'off'
    }
  },
  ...vue.configs['flat/essential'],
  {
    files: ['src/renderer/**/*.vue'],
    plugins: { '@intlify/vue-i18n': vueI18n },
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser
      },
      globals: globals.browser
    },
    settings: { 'vue-i18n': { messageSyntaxVersion: '^11.0.0' } }
  },
  {
    files: ['src/renderer/src/components/**/*.vue'],
    rules: {
      '@intlify/vue-i18n/no-raw-text': ['error', {
        attributes: { '/.+/': ['title', 'aria-label', 'aria-description', 'placeholder'] },
        // These nodes carry exact protocol/source/shortcut content rather than prose.
        ignoreNodes: ['code', 'kbd', 'pre'],
        ignorePattern: exactTechnicalText
      }]
    }
  },
  {
    files: ['src/renderer/src/App.vue'],
    rules: {
      // App.vue remains warning-scoped while its remaining legacy script code is extracted.
      // User-visible prose is catalog-driven; exact protocol/source tokens are exempted below.
      '@intlify/vue-i18n/no-raw-text': ['warn', {
        attributes: { '/.+/': ['title', 'aria-label', 'aria-description', 'placeholder'] },
        ignoreNodes: ['code', 'kbd', 'pre'],
        ignorePattern: exactTechnicalText
      }]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,vue}', 'website/**/*.ts'],
    languageOptions: { globals: globals.browser }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: globals.vitest }
  },
  {
    files: ['src/main/browser/{page-scripts,tabs-manager}.ts', 'src/main/home-page.ts'],
    rules: {
      // Protocol sanitizers and generated page scripts intentionally spell escapes explicitly.
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-unsafe-finally': 'off',
      'no-useless-assignment': 'off'
    }
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: { 'no-control-regex': 'off', 'no-useless-escape': 'off' }
  },
  {
    files: ['tests/**/*.ts'],
    rules: { 'no-useless-escape': 'off', '@typescript-eslint/no-this-alias': 'off' }
  },
  {
    files: ['tests/integration/fixtures.ts'],
    rules: { 'no-empty-pattern': 'off' }
  }
)
