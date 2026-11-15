export const zhCNLcpAttribution = {
  heading: 'LCP 阶段',
  note: '以浏览器计时精度进行的一次本地观察；各阶段并不能证明原因。',
  ttfb: '首字节时间',
  discovery: '资源加载延迟',
  transfer: '资源传输',
  render: '元素渲染延迟',
  complete: '完整的计时证据',
  incomplete: '不完整的计时证据',
  unsupported: '不支持的上下文',
  text: '文本 LCP：资源阶段不适用。',
  'missing-candidate': '候选元素的计时不可用。',
  'missing-navigation': '导航计时不可用。',
  'missing-resource': '缺少资源计时；不会假定加载时间为零。',
  'restricted-timing': '计时精度受到限制。',
  'inconsistent-timing': '计时证据与同一候选元素不匹配。',
  'unsupported-navigation': '此导航上下文无法进行阶段归因。'
}
