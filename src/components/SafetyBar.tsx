/** 모든 안내 화면 하단 고정 안전 바 */
export function SafetyBar({ onOtherRoute, onSos, sosBusy }: { onOtherRoute: () => void; onSos: () => void; sosBusy?: boolean }) {
  return (
    <nav className="safety-bar" aria-label="안전 버튼">
      <button className="btn btn--secondary" onClick={onOtherRoute}>다른 길 선택</button>
      <button className="btn btn--sos" onClick={onSos} disabled={sosBusy}>
        {sosBusy ? '위치 확인 중…' : '보호자에게 위치 전송'}
      </button>
    </nav>
  );
}
