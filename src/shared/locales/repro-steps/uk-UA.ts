export const ukUAReproSteps = {
  kinds: {
    navigate: 'перехід',
    click: 'клік',
    input: 'введення',
    key: 'клавіша',
    scroll: 'прокручування',
    expect: 'перевірка'
  },
  steps: {
    open: 'Відкрити {url}',
    navigate: 'Перейти на {url}',
    navigateWithin: 'Перейти в межах сторінки на {url}',
    click: 'Натиснути на {target}',
    input: 'Ввести текст у {target} (значення не записано)',
    key: 'Натиснути {key} (ціль: {target})',
    scroll: 'Прокрутити до x={x}, y={y}',
    expect: 'Очікуваний результат: {condition}',
    captureFailed: 'Не вдалося визначити ціль дії; відтворіть цю дію вручну.',
    captureInterrupted: 'Перехід перервав запис дії; відтворіть цю дію вручну.'
  },
  targets: {
    input: 'поле {type}',
    labelled: '{kind} «{label}»'
  },
  conditions: {
    visible: 'видимий',
    hidden: 'прихований',
    text: 'точний текст',
    checked: 'позначено',
    unchecked: 'не позначено',
    count: 'кількість елементів',
    urlPath: 'шлях URL'
  }
}
