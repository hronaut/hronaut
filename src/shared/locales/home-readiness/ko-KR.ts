export const koKRHomeReadiness = {
  heading: 'MCP 준비 상태',
  description: '브라우저 도구를 사용하기 전에 각 경계를 하나씩 확인하세요.',
  checks: {
    app: '애플리케이션',
    endpoint: '로컬 엔드포인트',
    initialization: '클라이언트 초기화',
    advertisedTools: '제공되는 도구',
    configuration: '클라이언트 구성',
    clientVisibility: '활성 클라이언트에 표시되는 도구',
    probe: '읽기 전용 점검'
  },
  inventory: '활성 클라이언트에 표시된 도구 목록을 붙여넣으세요',
  inventoryPlaceholder: 'browser_* 또는 wallet_* 도구 이름이 포함된 클라이언트 출력을 붙여넣으세요',
  verifyInventory: '도구 목록 비교',
  copyReport: '진단 정보 복사',
  reportLabel: '복사해도 안전한 MCP 준비 상태 진단',
  privacy: '비교는 이 페이지 안에서만 이루어집니다. 복사된 보고서에는 정해진 상태 값, 개수, 길이가 제한된 도구 이름, 타임스탬프만 포함됩니다.',
  nextAction: {
    start_honaut: '로컬 Hronaut 리스너를 시작하거나 복구하세요.',
    connect_client: '활성 MCP 클라이언트를 다시 연결하고 초기화가 끝날 때까지 기다리세요.',
    verify_client_configuration: '활성 클라이언트 구성에서 이 엔드포인트와 인증을 확인하세요.',
    list_tools_in_active_client: '활성 클라이언트에서 도구 목록을 표시한 후 여기에서 비교하세요.',
    run_read_only_probe: '태스크가 소유한 작업 공간에서 browser_status 또는 browser_snapshot을 한 번 호출하세요.',
    retry_read_only_probe: '활성 클라이언트의 오류를 확인한 후 읽기 전용 점검을 한 번 다시 시도하세요.',
    none: '이 항목은 조치가 필요하지 않습니다.'
  }
}
