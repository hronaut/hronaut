export const koKRNetworkLabels = {
  resourceTypes: {
    document: '문서',
    stylesheet: '스타일시트',
    image: '이미지',
    media: '미디어',
    font: '글꼴',
    script: '스크립트',
    texttrack: '텍스트 트랙',
    xhr: 'XHR',
    fetch: 'Fetch',
    prefetch: '프리페치',
    eventsource: 'EventSource',
    websocket: 'WebSocket',
    manifest: '매니페스트',
    signedexchange: '서명된 교환',
    ping: '핑',
    cspviolationreport: 'CSP 위반 보고서',
    preflight: '프리플라이트',
    fedcm: 'FedCM',
    other: '기타'
  },
  responseSources: {
    network: '네트워크',
    serviceWorker: '서비스 워커',
    prefetchCache: '프리페치 캐시',
    diskCache: '디스크 캐시',
    otherCache: '브라우저 캐시'
  },
  workerSources: {
    cacheStorage: '캐시 저장소',
    httpCache: 'HTTP 캐시',
    fallbackCode: '워커 대체 코드',
    network: '워커를 통한 네트워크'
  },
  initiatorTypes: {
    parser: '파서',
    script: '스크립트',
    preload: '미리 로드',
    signedexchange: '서명된 교환',
    preflight: '프리플라이트',
    fedcm: 'FedCM',
    redirect: '리디렉션',
    other: '기타'
  },
  messageDirections: {
    sent: '보냄',
    received: '받음',
    error: '오류'
  },
  messageKinds: {
    text: '텍스트',
    binary: '바이너리',
    continuation: '연속',
    close: '닫기',
    ping: '핑',
    pong: '퐁',
    error: '오류',
    unknown: '알 수 없음'
  },
  bodyNotes: {
    binary: '바이너리 본문은 생략되었습니다.',
    multipart: '멀티파트 본문은 생략되었습니다.',
    unsafeJson: 'JSON 본문을 안전하게 가릴 수 없어 생략했습니다.',
    nonText: '텍스트가 아닌 본문은 생략되었습니다.'
  },
  bodyReasons: {
    eventStream: '서버 전송 이벤트는 크기가 제한된 이벤트 스트림 섹션에서 볼 수 있습니다.',
    webSocket: 'WebSocket 메시지는 크기가 제한된 메시지 섹션에서 볼 수 있습니다.',
    expired: 'Chromium에서 더 이상 응답 본문을 가져올 수 없습니다.',
    incomplete: '응답 본문이 아직 완료되지 않았습니다.',
    devToolsCapture: '개발자 도구가 이 탭을 사용하는 동안에는 상세 캡처를 사용할 수 없었습니다.',
    omittedFromExport: '정리된 이 내보내기에서는 응답 본문이 생략되었습니다.',
    closeDevTools: '이 탭의 개발자 도구를 닫은 후 세부정보를 다시 요청하세요.',
    evicted: 'Chromium의 크기가 제한된 진단 버퍼에 이 응답 본문이 더 이상 없습니다.'
  },
  searchFields: {
    error: '요청 오류',
    message: '{direction} {kind} 메시지',
    event: '{name} 이벤트'
  }
}
