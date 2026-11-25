import { useState } from 'react';

export interface DevActions {
  board: () => void;
  nextStation: () => void;
  wrongDirection: () => void;
  slowDown: () => void;
  plusMinute: () => void;
  simulateRestore: () => void;
  reset: () => void;
}

/** 하단 접이식 개발자 테스트 패널 (ODsay 키 없이 시연용) */
export function DevTestPanel({ actions, info, enabled }: { actions: DevActions; info: string; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="dev-panel" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>🛠 개발자 테스트 패널 {open ? '닫기' : '열기'}</summary>
      <p className="dev-panel__info">{info}</p>
      <div className="dev-panel__grid">
        <button onClick={actions.board} disabled={!enabled}>탑승 처리</button>
        <button onClick={actions.nextStation} disabled={!enabled}>다음 역 도착</button>
        <button onClick={actions.wrongDirection} disabled={!enabled}>역방향 역 감지</button>
        <button onClick={actions.slowDown} disabled={!enabled}>서행 테스트</button>
        <button onClick={actions.plusMinute} disabled={!enabled}>시간 +1분</button>
        <button onClick={actions.simulateRestore} disabled={!enabled}>앱 재실행(10분 후) 흉내</button>
        <button onClick={actions.reset}>처음으로 / 세션 삭제</button>
      </div>
      <p className="dev-panel__note">
        샘플 경로·문 번호·버스 번호·정류장은 시연용 가상 데이터입니다.
      </p>
    </details>
  );
}
