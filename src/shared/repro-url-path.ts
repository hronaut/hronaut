/** A reviewed, serialized HTTP(S) pathname, never a full URL or URL pattern. */
export function validReproUrlPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048
    || !value.startsWith('/') || value.startsWith('//')
    || /[\p{Cc}\p{Cf}\s?#\\]/u.test(value) || /%(?![\da-f]{2})/i.test(value)) return false
  try { return new URL(value, 'https://hronaut.invalid').pathname === value }
  catch { return false }
}
