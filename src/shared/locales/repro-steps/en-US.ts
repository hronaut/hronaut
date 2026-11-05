// Repro recorder step names and sentences; src/shared/repro-step-text.ts holds the English that main writes.
export const enUSReproSteps = {
  kinds: {
    navigate: 'navigate',
    click: 'click',
    input: 'input',
    key: 'key',
    scroll: 'scroll',
    expect: 'expect'
  },
  steps: {
    open: 'Open {url}',
    navigate: 'Navigate to {url}',
    navigateWithin: 'Navigate within the page to {url}',
    click: 'Click {target}',
    input: 'Type in {target} (value not recorded)',
    key: 'Press {key} on {target}',
    scroll: 'Scroll to x={x}, y={y}',
    expect: 'Expected result: {condition}',
    captureFailed: 'Action target could not be captured; recreate this action manually.',
    captureInterrupted: 'Action capture interrupted by navigation; recreate this action manually.'
  },
  targets: {
    input: '{type} input',
    labelled: '{kind} “{label}”'
  },
  conditions: {
    visible: 'visible',
    hidden: 'hidden',
    text: 'text',
    checked: 'checked',
    unchecked: 'unchecked',
    count: 'count',
    urlPath: 'urlPath'
  }
}
