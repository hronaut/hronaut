export const jaJPReproSteps = {
  kinds: {
    navigate: 'ナビゲーション',
    click: 'クリック',
    input: '入力',
    key: 'キー',
    scroll: 'スクロール',
    expect: '確認'
  },
  steps: {
    open: '{url} を開く',
    navigate: '{url} に移動',
    navigateWithin: 'ページ内で {url} に移動',
    click: '{target} をクリック',
    input: '{target} に入力（値は記録されていません）',
    key: '{target} で {key} を押す',
    scroll: 'x={x}, y={y} までスクロール',
    expect: '期待される結果：{condition}',
    captureFailed: '操作の対象を記録できませんでした。この操作は手動で再現してください。',
    captureInterrupted: 'ページの移動によって操作の記録が中断されました。この操作は手動で再現してください。'
  },
  targets: {
    input: '{type} 入力欄',
    labelled: '{kind}「{label}」'
  },
  conditions: {
    visible: '表示',
    hidden: '非表示',
    text: 'テキスト',
    checked: 'チェックあり',
    unchecked: 'チェックなし',
    count: '要素数',
    urlPath: 'URL パス'
  }
}
