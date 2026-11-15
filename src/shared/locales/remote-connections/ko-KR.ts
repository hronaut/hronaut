export const koKRRemoteConnections = {
  label: '다른 컴퓨터의 연결 허용',
  description: '모든 IPv4 네트워크 인터페이스에서 수신 대기합니다. 토큰 인증은 선택사항입니다. 인증을 사용하지 않으면 이 리스너에 접근할 수 있는 누구나 브라우저를 제어하고 로컬 파일을 첨부할 수 있습니다.',
  restart: '원격 액세스를 변경한 후에는 Hronaut을 다시 시작하세요. 인증 변경 사항은 즉시 적용됩니다.',
  connection: '다른 컴퓨터에서 http://this-computer-LAN-IP:{port}/mcp를 사용하고, 인증을 사용하는 경우 아래 권한 프로필의 Bearer 자격 증명을 사용하세요. 방화벽에서 이 포트를 허용하세요. HTTP는 트래픽을 암호화하지 않으므로 신뢰할 수 있는 네트워크에서만 사용하세요.'
}
