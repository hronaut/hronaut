export const koKRReproSteps = {
  kinds: {
    navigate: '이동',
    click: '클릭',
    input: '입력',
    key: '키',
    scroll: '스크롤',
    expect: '확인'
  },
  steps: {
    open: '{url} 열기',
    navigate: '{url}(으)로 이동',
    navigateWithin: '페이지 안에서 {url}(으)로 이동',
    click: '{target} 클릭',
    input: '{target}에 입력(값은 기록되지 않음)',
    key: '{target}에서 {key} 누르기',
    scroll: 'x={x}, y={y} 위치로 스크롤',
    expect: '예상 결과: {condition}',
    captureFailed: '작업 대상을 캡처할 수 없습니다. 이 작업을 직접 다시 만드세요.',
    captureInterrupted: '페이지 이동으로 작업 캡처가 중단되었습니다. 이 작업을 직접 다시 만드세요.'
  },
  targets: {
    input: '{type} 입력란',
    labelled: '{kind} ‘{label}’'
  },
  conditions: {
    visible: '표시됨',
    hidden: '숨겨짐',
    text: '텍스트',
    checked: '선택됨',
    unchecked: '선택 해제됨',
    count: '개수',
    urlPath: 'URL 경로'
  }
}
