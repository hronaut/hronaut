/** @type {import('stylelint').Config} */
export default {
  referenceFiles: ['src/renderer/src/**/*.css'],
  rules: {
    'block-no-empty': true,
    'color-no-invalid-hex': true,
    'declaration-block-no-duplicate-custom-properties': true,
    'declaration-block-no-duplicate-properties': true,
    'no-duplicate-at-import-rules': true,
    'no-invalid-position-declaration': true,
    'no-unknown-animations': true,
    'no-unknown-custom-properties': true,
    'property-no-unknown': true,
    'selector-pseudo-class-no-unknown': true,
    'selector-pseudo-element-no-unknown': true
  }
}
