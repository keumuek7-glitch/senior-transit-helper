import type { ReconcileWarning } from '../core/stateMachine/sessionTimeReconciler';

/** 앱 재실행 시 하차 시점 경과 경고 + [지금 위치에서 길 다시 찾기] */
export function MissedStopRecoveryBanner({
  warning,
  onReroute,
  onDismiss,
}: {
  warning: ReconcileWarning;
  onReroute: () => void;
  onDismiss: () => void;
}) {
  if (warning.kind === 'NONE') return null;
  if (warning.kind === 'ALIGHT_SOON') {
    return (
      <div className="banner banner--alert" role="alert">
        <p className="banner__title">곧 {warning.alightName}에서 내리셔야 해요</p>
        <button className="btn btn--secondary" onClick={onDismiss}>알겠어요</button>
      </div>
    );
  }
  return (
    <div className="banner banner--warning" role="alert">
      <p className="banner__title">
        내리실 곳({warning.alightName})을
        <br />약 {Math.max(1, warning.overdueMin)}분 지났을 수 있어요
      </p>
      <button className="btn btn--primary" onClick={onReroute}>지금 위치에서 길 다시 찾기</button>
      <button className="btn btn--secondary" onClick={onDismiss}>아직 안 지났어요, 계속 안내</button>
    </div>
  );
}
