export const zhCNReproSteps = {
  kinds: {
    navigate: '导航',
    click: '点击',
    input: '输入',
    key: '按键',
    scroll: '滚动',
    expect: '预期'
  },
  steps: {
    open: '打开 {url}',
    navigate: '导航到 {url}',
    navigateWithin: '在页面内导航到 {url}',
    click: '点击 {target}',
    input: '在 {target} 中输入（未记录值）',
    key: '在 {target} 上按 {key}',
    scroll: '滚动到 x={x}, y={y}',
    expect: '预期结果：{condition}',
    captureFailed: '无法捕获操作目标；请手动重新创建此操作。',
    captureInterrupted: '操作捕获被导航中断；请手动重新创建此操作。'
  },
  targets: {
    input: '{type} 输入框',
    labelled: '{kind}“{label}”'
  },
  conditions: {
    visible: '可见',
    hidden: '隐藏',
    text: '文本',
    checked: '已选中',
    unchecked: '未选中',
    count: '数量',
    urlPath: '网址路径'
  }
}
