export const ruRUReproSteps = {
  kinds: {
    navigate: 'переход',
    click: 'клик',
    input: 'ввод',
    key: 'клавиша',
    scroll: 'прокрутка',
    expect: 'проверка'
  },
  steps: {
    open: 'Открыть {url}',
    navigate: 'Перейти на {url}',
    navigateWithin: 'Перейти в пределах страницы на {url}',
    click: 'Нажать на {target}',
    input: 'Ввести текст в {target} (значение не записано)',
    key: 'Нажать {key} в {target}',
    scroll: 'Прокрутить до x={x}, y={y}',
    expect: 'Ожидаемый результат: {condition}',
    captureFailed: 'Не удалось определить цель действия; воспроизведите это действие вручную.',
    captureInterrupted: 'Переход прервал запись действия; воспроизведите это действие вручную.'
  },
  targets: {
    input: 'поле {type}',
    labelled: '{kind} «{label}»'
  },
  conditions: {
    visible: 'видимый',
    hidden: 'скрытый',
    text: 'точный текст',
    checked: 'отмечено',
    unchecked: 'не отмечено',
    count: 'количество элементов',
    urlPath: 'путь URL'
  }
}
