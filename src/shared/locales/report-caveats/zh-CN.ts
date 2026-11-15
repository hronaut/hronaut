export const zhCNReportCaveats = {
  performance: {
    lcpPhases: 'LCP 阶段是基于浏览器计时的观察结果，并非因果证明。缺失或受限的证据会明确标示；不支持恢复和软导航的阶段归因。',
    localSample: '这是本次访问的单个本地样本，并非实际用户数据，也不是 CrUX 第 75 百分位的结果。',
    inpUnavailable: '在页面收到符合条件的交互之前，INP 不可用；对于后台访问或短暂访问，部分指标不可用。',
    longAnimationFrames: '长动画帧归因识别的是脚本入口点，而不一定是内部最慢的函数。',
    crossOrigin: '跨源框架、Worker、Service Worker 和隔离环境中的代码可能会产生工作量，但没有脚本归因。',
    userTimings: '用户计时名称由页面编写并已脱敏；任意 detail 对象、堆栈轨迹和源代码都会被省略。',
    layoutShifts: '布局偏移证据不包括最近有离散输入的条目。其分数总和仅用于诊断，可能与 CLS 会话窗口评分不同。',
    baselineUrl: '基准网址与此次测量不同；仅当导航更改是有意为之时才进行比较。',
    environment: '浏览器环境与基准不同；视口、节流、缓存、标头或语言区域的更改都可能影响差异值。',
    deltas: '前后差异比较的是两个本地样本，可能包含正常的运行间波动；请在相同条件下重复进行重要的测量。'
  },
  accessibilityComparison: {
    urlChanged: '设置无障碍基准后页面网址已更改。',
    scopeChanged: '无障碍标准、选择器或收集限制已更改；请为此范围设置新的基准。',
    engineChanged: '无障碍引擎已更改；比较发现之前，请先设置新的基准。',
    baselineTruncated: '基准已被截断，因此无法安全地确定新的发现。',
    currentTruncated: '当前审核已被截断，因此无法安全地确定已解决的发现。'
  },
  indexedDb: {
    origin: '仅涵盖此顶层来源；不包括第三方框架中的数据库。',
    snapshot: '数据库和记录是某一时间点的快照。网站更改 IndexedDB 后，请刷新。',
    names: '数据库、对象存储、索引和键的名称由网站编写，其本身可能包含隐私数据。',
    longNames: '名称超过 512 个字符的数据库和对象存储会被省略。',
    valuesIncluded: '记录预览有长度限制，并且可能包含应用的隐私数据。',
    valuesOmitted: '记录值已被省略。',
    readOnly: '此检查器只会读取 IndexedDB，绝不会更改或清除它。'
  },
  storageUsage: {
    estimates: '用量和配额是浏览器在某一时间点的估算值，可能会随着 Chromium 逐出或写入数据而变化。',
    quota: '配额是 Chromium 当前为此来源报告的预算，而不是设备上的可用空间。',
    origin: '仅涵盖此顶层 HTTP(S) 来源；第三方存储和分区存储可能会单独计算。',
    aggregates: '仅显示字节总数和浏览器的存储类别。绝不包括键、值、文件名和响应正文。',
    readOnly: '此检查器只会读取存储用量，绝不会更改或清除数据。',
    fallback: 'Chromium 的详细配额明细不可用，因此此报告使用浏览器的总体估算值：{reason}'
  },
  storageChanges: {
    baseline: '基准仅保存在内存中，在您清除它、标签页更改来源或关闭，或者 Hronaut 退出时会被舍弃。',
    scope: '本地存储和 Cookie 在此工作区内按来源共享，并与其他工作区隔离；会话存储仅属于此标签页。',
    valuesIncluded: '值会在大小限制内显示。HttpOnly Cookie 值始终受到保护。',
    valuesOmitted: '值已被省略。',
    snapshot: '快照涵盖每种存储类型排序后的前 200 个条目。在设置基准与比较之间，存储也可能在后台发生变化。'
  },
  pwa: {
    origin: '仅涵盖此顶层来源；不包括第三方框架中的 Worker 和缓存。',
    snapshot: '注册和缓存条目是某一时间点的快照。网站更改其离线状态后，请刷新。',
    manifest: '清单会被读取为少量有限的字段；绝不会显示其原始源代码。',
    installabilityIds: '可安装性错误标识符来自 Chromium，可能会因 Chromium 版本而异。',
    readOnly: '此检查器只会读取离线数据，绝不会显示缓存的响应正文。',
    headersIncluded: '请求标头和响应标头会在限制范围内显示；可识别的携带机密信息的标头会被隐去。',
    headersOmitted: '标头值已被省略。',
    opaqueSizes: '不透明响应的大小可能包含浏览器的配额填充，此处不进行测量。',
    clearing: '此检查器绝不会注销 Worker 或清除缓存。',
    installabilityUnavailable: '可安装性诊断不可用：{reason}'
  }
}
