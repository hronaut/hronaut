import { describe, expect, it } from 'vitest'
import { FORM_VALIDITY_FLAGS, normalizeFormValidity } from '../src/shared/form-validity.js'
import { normalizeElementInspection } from '../src/shared/element-inspection.js'

const observed = () => ({
  status: 'observed', willValidate: false,
  validity: Object.fromEntries(FORM_VALIDITY_FLAGS.map(flag => [flag, flag === 'valid']))
})

describe('bounded native form-validity reports', () => {
  it('preserves native eligibility separately from valid state', () => {
    const raw = observed()
    const result = normalizeFormValidity(raw)
    expect(result).toEqual(raw)
    expect(result).not.toBe(raw)
    expect(JSON.stringify(result).length).toBeLessThan(512)
  })
  it.each(FORM_VALIDITY_FLAGS)('rejects a missing or nonboolean %s', flag => {
    const raw = observed()
    delete raw.validity[flag]
    expect(normalizeFormValidity(raw)).toEqual({ status: 'unavailable', reason: 'native-unavailable' })
    expect(normalizeFormValidity({ ...raw, validity: { ...raw.validity, [flag]: 'private field data' } })).toEqual({ status: 'unavailable', reason: 'native-unavailable' })
  })
  it.each([null, [], 'private data', {}, { ...observed(), validationMessage: 'PRIVATE_MESSAGE' }, { ...observed(), value: 'PRIVATE_VALUE' }, { ...observed(), validity: { ...observed().validity, length: 17 } }])('does not forward malformed or expanded reports', raw => {
    expect(normalizeFormValidity(raw)).toEqual({ status: 'unavailable', reason: 'native-unavailable' })
  })
  it('preserves explicit unsupported state without adding flags', () => {
    expect(normalizeFormValidity({ status: 'unavailable', reason: 'unsupported-target' })).toEqual({ status: 'unavailable', reason: 'unsupported-target' })
  })
  it('leaves ordinary inspection unchanged and normalizes only an explicit field', () => {
    const input = { tabId: 'tab', title: '', url: 'https://example.test', raw: { selector: '#target', tag: 'input' } }
    expect(normalizeElementInspection(input)).not.toHaveProperty('formValidity')
    expect(normalizeElementInspection({ ...input, raw: { ...input.raw, formValidity: observed() } }).formValidity).toEqual(observed())
  })
})
