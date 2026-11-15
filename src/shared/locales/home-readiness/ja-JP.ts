export const jaJPHomeReadiness = {
  heading: 'MCP の準備状況',
  description: 'ブラウザ ツールを利用する前に、各境界を個別に確認してください。',
  checks: {
    app: 'アプリケーション',
    endpoint: 'ローカル エンドポイント',
    initialization: 'クライアントの初期化',
    advertisedTools: '公開されているツール',
    configuration: 'クライアントの設定',
    clientVisibility: 'アクティブなクライアントで表示されるツール',
    probe: '読み取り専用のプローブ'
  },
  inventory: 'アクティブなクライアントに表示されているツールの一覧を貼り付けてください',
  inventoryPlaceholder: 'browser_* または wallet_* のツール名を含むクライアントの出力を貼り付けます',
  verifyInventory: 'ツールの一覧を比較',
  copyReport: '診断情報をコピー',
  reportLabel: 'コピーしても安全な MCP 準備状況の診断情報',
  privacy: '比較はこのページ内で行われます。コピーされるレポートには、型付きの状態、件数、範囲を限定したツール名、タイムスタンプのみが含まれます。',
  nextAction: {
    start_honaut: 'ローカルの Hronaut リスナーを起動または修復してください。',
    connect_client: 'アクティブな MCP クライアントを再接続し、初期化が完了するまでお待ちください。',
    verify_client_configuration: 'アクティブなクライアントの設定で、このエンドポイントと認証を確認してください。',
    list_tools_in_active_client: 'アクティブなクライアントでツールを一覧表示し、ここで比較してください。',
    run_read_only_probe: 'タスク専用のワークスペースで、browser_status または browser_snapshot を 1 回呼び出してください。',
    retry_read_only_probe: 'アクティブなクライアントのエラーを確認してから、読み取り専用のプローブを 1 回再試行してください。',
    none: 'このチェックで必要な操作はありません。'
  }
}
