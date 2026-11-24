/** What the watcher keeps on the window of its own world, apart from the page's scripts. */
interface TypedValuesWatcher {
  fields: Set<Element>
  report: ((values: string[] | null) => void) | null
  timer: number
  /** A report came due while no watcher waited for it, as between one report and the next watcher. */
  due: boolean
  send: () => void
}

/**
 * Runs in Hronaut's own isolated world of the page: watches the fields the person types, pastes or fills into, and gives
 * their values half a second after the last change, when a field's change is committed or a form is submitted, once.
 * Each report holds only the fields changed since the one before; one that came due before this watcher started is
 * given at once. A second watcher in the same document takes over from the first, which gives null.
 */
export function personTypedValuesInPage(): Promise<string[] | null> {
  return new Promise((resolve) => {
    const scope = window as unknown as { __hronautTypedValues?: TypedValuesWatcher }
    let watcher = scope.__hronautTypedValues
    if (!watcher) {
      const created: TypedValuesWatcher = { fields: new Set(), report: null, timer: 0, due: false, send: () => undefined }
      watcher = created
      scope.__hronautTypedValues = created
      const editable = (target: EventTarget | undefined): Element | null => {
        if (target instanceof HTMLTextAreaElement) return target
        if (target instanceof HTMLInputElement) {
          return ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(target.type)
            ? null : target
        }
        if (target instanceof HTMLElement && target.isContentEditable) {
          let host: HTMLElement = target
          while (host.parentElement?.isContentEditable) host = host.parentElement
          return host
        }
        return null
      }
      const value = (field: Element): string => field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
        ? field.value : (field as HTMLElement).innerText
      const send = (): void => {
        window.clearTimeout(created.timer)
        const report = created.report
        if (!created.fields.size) return
        created.due = !report
        if (!report) return
        const values = [...created.fields].map(value).filter(Boolean)
        created.fields = new Set()
        created.report = null
        report(values)
      }
      document.addEventListener('input', (event) => {
        if (!event.isTrusted) return
        const field = editable(event.composedPath()[0])
        if (!field) return
        created.fields.add(field)
        window.clearTimeout(created.timer)
        created.timer = window.setTimeout(send, 500)
      }, true)
      document.addEventListener('change', (event) => { if (event.isTrusted) send() }, true)
      document.addEventListener('submit', send, true)
      created.send = send
    }
    watcher.report?.(null)
    watcher.report = resolve
    if (watcher.due) watcher.send()
  })
}
