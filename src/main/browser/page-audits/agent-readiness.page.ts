/** Counts the top-level document's forms, and those with neither a WebMCP toolname nor a tooldescription attribute. */
export function countWebMcpForms(): { forms: number; unannotated: number } {
  const forms = Array.from(document.querySelectorAll('form'))
  return {
    forms: forms.length,
    unannotated: forms.filter(form => !form.hasAttribute('toolname') && !form.hasAttribute('tooldescription')).length
  }
}
