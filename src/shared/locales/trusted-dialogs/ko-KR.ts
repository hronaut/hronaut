export const koKRTrustedDialogs = {
  close: '닫기',
  httpAuth: {
    eyebrow: '로그인',
    headline: '{origin}에 로그인',
    notPrivate: '이 사이트와의 연결은 비공개가 아닙니다. 네트워크의 누구나 사용자 이름과 비밀번호를 읽을 수 있습니다.',
    workspace: 'Hronaut을 종료할 때까지 ‘{workspace}’ 작업 공간에서 이 웹사이트에 로그인된 상태가 유지됩니다.',
    sent: 'Hronaut은 사용자 이름과 비밀번호를 이 웹사이트에만 보내며, 에이전트에게 절대 보여 주지 않습니다.',
    username: '사용자 이름',
    password: '비밀번호',
    signIn: '로그인'
  },
  certificate: {
    eyebrow: '비공개 아님',
    headline: '{host}(으)로 이동할까요?',
    authority: '이 사이트의 보안 인증서는 이 컴퓨터가 신뢰하는 기관에서 발급되지 않았습니다.',
    name: '이 사이트의 보안 인증서는 다른 웹사이트의 것입니다.',
    date: '이 사이트의 보안 인증서가 만료되었거나 아직 유효하지 않습니다.',
    other: '이 사이트의 보안 인증서를 확인할 수 없습니다.',
    risk: '네트워크상의 누군가가 이 웹사이트인 척하며 비밀번호처럼 보내는 내용을 읽으려고 할 수 있습니다.',
    workspace: 'Hronaut을 종료할 때까지 ‘{workspace}’ 작업 공간에서 이 웹사이트의 이 인증서를 신뢰하며, 작업 공간의 에이전트도 이 사이트를 열 수 있습니다.',
    session: 'Hronaut을 종료할 때까지 이 웹사이트의 이 인증서를 신뢰합니다.',
    back: '안전한 페이지로 돌아가기',
    proceed: '이동(안전하지 않음)'
  },
  savePassword: {
    eyebrow: '저장된 비밀번호',
    save: '{origin}의 비밀번호를 저장하시겠습니까?',
    update: '{origin}의 저장된 비밀번호를 업데이트하시겠습니까?',
    username: '사용자 이름',
    noUsername: '페이지에서 사용자 이름을 함께 보내지 않았습니다.',
    stored: 'Hronaut은 운영체제의 보안 저장소로 비밀번호를 암호화합니다. 저장된 비밀번호는 MCP를 통해 노출되지 않습니다.'
  },
  walletRecovery: {
    eyebrow: '새 지갑',
    headline: '{wallet}의 복구 문구를 적어 두세요',
    phrase: '복구 문구',
    keep: '이 단어들을 순서대로 적어 오프라인에 보관하세요. 이 단어를 가진 사람은 누구나 지갑을 제어할 수 있습니다.',
    added: '단어를 저장했음을 확인하면 Hronaut에서 지갑을 추가합니다.'
  },
  claudeSetup: {
    file: '파일',
    added: '"mcpServers"의 새 항목',
    replaces: '대체되는 항목'
  },
  sitePermission: {
    embeddedIn: '{site}에 삽입됨',
    wants: {
      camera: '{origin}에서 카메라를 사용하려고 합니다',
      microphone: '{origin}에서 마이크를 사용하려고 합니다',
      cameraAndMicrophone: '{origin}에서 카메라와 마이크를 사용하려고 합니다',
      geolocation: '{origin}에서 사용자의 위치를 확인하려고 합니다',
      notifications: '{origin}에서 알림을 표시하려고 합니다',
      clipboardRead: '{origin}에서 복사한 텍스트와 이미지를 보려고 합니다',
      midiSysex: '{origin}에서 MIDI 기기를 제어하고 다시 프로그래밍하려고 합니다',
      midi: '{origin}에서 MIDI 기기를 사용하려고 합니다',
      localFonts: '{origin}에서 컴퓨터의 글꼴을 사용하려고 합니다',
      localNetwork: '{origin}에서 로컬 네트워크의 기기를 찾아 연결하려고 합니다',
      loopbackNetwork: '{origin}에서 이 기기의 앱 및 서비스에 연결하려고 합니다',
      fileSystem: '{origin}에서 컴퓨터의 파일이나 폴더를 사용하려고 합니다',
      openExternal: '{origin}에서 컴퓨터의 앱을 열려고 합니다',
      idleDetection: '{origin}에서 사용자가 이 기기를 사용 중인지 확인하려고 합니다',
      keyboardLock: '{origin}에서 키보드 단축키를 캡처하려고 합니다',
      pointerLock: '{origin}에서 마우스 포인터를 잠그고 숨기려고 합니다',
      windowManagement: '{origin}에서 모든 디스플레이의 창을 관리하려고 합니다',
      displayCapture: '{origin}에서 화면을 보려고 합니다',
      other: '{origin}에서 ‘{permission}’ 권한을 사용하려고 합니다'
    }
  }
}
