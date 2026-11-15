export const zhTWReportCaveats = {
  performance: {
    lcpPhases: 'LCP 階段是瀏覽器計時的觀察結果，並非因果證明。缺少或受限的證據會明確標示；不支援還原與軟性導覽的階段歸因。',
    localSample: '這是目前造訪的單一本機樣本，並非實際使用者資料或 CrUX 第 75 百分位數結果。',
    inpUnavailable: '網頁收到符合條件的互動之前，無法取得 INP；在背景中或短暫的造訪，部分指標也無法取得。',
    longAnimationFrames: '長動畫影格歸因會找出指令碼的進入點，但不一定是內部最慢的函式。',
    crossOrigin: '跨來源框架、Worker、Service Worker 及隔離環境中的程式碼可能會產生工作負載，但沒有指令碼歸因。',
    userTimings: 'User Timing 名稱由網頁自行撰寫並經過清理；任意的 detail 物件、堆疊追蹤和原始碼都會省略。',
    layoutShifts: '版面配置位移證據會排除最近有離散輸入的項目。其分數總和僅供診斷，可能與 CLS 工作階段視窗計分不同。',
    baselineUrl: '基準網址與這次測量不同；只有在刻意變更導覽時才進行比較。',
    environment: '瀏覽器環境與基準不同；檢視區、節流、快取、標頭或語言代碼的變更都可能影響差異值。',
    deltas: '前後差異值比較的是兩個本機樣本，可能包含每次執行之間的正常變動；重要的測量請在相同條件下重複進行。'
  },
  accessibilityComparison: {
    urlChanged: '建立無障礙基準後，網頁網址已變更。',
    scopeChanged: '無障礙標準、選取器或收集上限已變更；請為這個範圍設定新的基準。',
    engineChanged: '無障礙引擎已變更；比較檢查結果前，請先設定新的基準。',
    baselineTruncated: '基準已遭截斷，因此無法安全判斷新的檢查結果。',
    currentTruncated: '目前的稽核已遭截斷，因此無法安全判斷已解決的檢查結果。'
  },
  indexedDb: {
    origin: '僅涵蓋這個頂層來源；不包含第三方框架中的資料庫。',
    snapshot: '資料庫和記錄是某個時間點的快照。網站變更 IndexedDB 後，請重新整理。',
    names: '資料庫、物件存放區、索引和鍵的名稱由網站撰寫，本身就可能含有私人資料。',
    longNames: '名稱超過 512 個字元的資料庫和物件存放區會略去。',
    valuesIncluded: '記錄預覽有長度上限，可能含有私人的應用程式資料。',
    valuesOmitted: '已略去記錄值。',
    readOnly: '這個檢查器只會讀取 IndexedDB，絕不會變更或清除其中的資料。'
  },
  storageUsage: {
    estimates: '用量和配額是瀏覽器在某個時間點的估計值，可能會隨著 Chromium 清除或寫入資料而改變。',
    quota: '配額是 Chromium 目前為這個來源回報的預算，而不是裝置上的可用空間。',
    origin: '僅涵蓋這個頂層 HTTP(S) 來源；第三方和分區儲存空間可能會另外計算。',
    aggregates: '僅顯示位元組總數和瀏覽器的儲存空間類別，絕不會包含鍵、值、檔案名稱和回應內文。',
    readOnly: '這個檢查器只會讀取儲存空間用量，絕不會變更或清除資料。',
    fallback: '無法取得 Chromium 的詳細配額明細，因此這份報告使用瀏覽器的整體估計值：{reason}'
  },
  storageChanges: {
    baseline: '基準只會保留在記憶體中；當你清除基準、分頁變更來源或關閉，或 Hronaut 結束時，基準就會遭到捨棄。',
    scope: '本機儲存空間和 Cookie 在這個工作區內依來源共用，並與其他工作區隔離；工作階段儲存空間只屬於這個分頁。',
    valuesIncluded: '值會在大小上限內顯示。HttpOnly Cookie 的值一律受到保護。',
    valuesOmitted: '已略去值。',
    snapshot: '快照涵蓋每種儲存空間經排序後的前 200 個項目。在建立基準和進行比較之間，儲存空間也可能在背景中變更。'
  },
  pwa: {
    origin: '僅涵蓋這個頂層來源；不包含第三方框架中的 Worker 和快取。',
    snapshot: '註冊項目和快取項目是某個時間點的快照。網站變更離線狀態後，請重新整理。',
    manifest: '資訊清單只會讀入少數幾個有長度上限的欄位，絕不會顯示其原始內容。',
    installabilityIds: '可安裝性錯誤 ID 來自 Chromium，可能會因 Chromium 版本而異。',
    readOnly: '這個檢查器只會讀取離線資料，絕不會顯示快取的回應內文。',
    headersIncluded: '要求和回應標頭會在上限內顯示；已知會攜帶機密資訊的標頭會經過遮蓋。',
    headersOmitted: '已略去標頭值。',
    opaqueSizes: '不透明回應的大小可能包含瀏覽器的配額填補，這裡不會測量。',
    clearing: '這個檢查器絕不會取消註冊 Worker 或清除快取。',
    installabilityUnavailable: '無法取得可安裝性診斷資訊：{reason}'
  }
}
