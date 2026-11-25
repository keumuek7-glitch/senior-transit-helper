import type { ClassifiedRoutes, ScoredRoute } from '../core/classifier/seniorRouteClassifier';
import { getLineVisual, BUS_VISUAL } from '../core/metadata/subwayLineVisuals';
import { normalizeLineKey } from '../core/metadata/stationTransferMetadata';

function RideChips({ route }: { route: ScoredRoute }) {
  const rides = route.candidate.segments.filter((s) => s.mode !== 'WALK');
  return (
    <div className="chips">
      {rides.map((s, i) => {
        const v = s.mode === 'SUBWAY' ? getLineVisual(s.lineName, s.subwayCode) : BUS_VISUAL;
        const label = s.mode === 'SUBWAY' ? normalizeLineKey(s.lineName) || '전철' : `${s.busNo ?? ''} 버스`;
        return (
          <span key={i} className="chip" style={{ background: v.bgHex, color: v.textHex }}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

function RouteCard(props: { kind: 'comfort' | 'fast' | 'single'; route: ScoredRoute; onPick: () => void }) {
  const { route } = props;
  const title =
    props.kind === 'comfort' ? '🟢 편하게 걷기' : props.kind === 'fast' ? '🔵 빨리 가기' : '⭐ 가장 편하고 빠른 추천 길';
  return (
    <section className={`route-card route-card--${props.kind}`}>
      <h2>{title}</h2>
      {props.kind === 'comfort' && <p className="tag">기본 추천</p>}
      <p className="route-card__time">약 {Math.round(route.adjustedTotalMin)}분</p>
      <ul className="route-card__facts">
        <li>걷기 약 {Math.round(route.adjustedWalkMin)}분 (천천히 걷는 기준)</li>
        <li>갈아타기 {route.candidate.transferCount}번</li>
      </ul>
      <RideChips route={route} />
      {route.heavyTransfers.length > 0 && (
        <p className="warn">⚠ 오래 걷는 환승역: {route.heavyTransfers.join(', ')}</p>
      )}
      {props.kind !== 'comfort' && route.tightTransfer && <p className="warn">⚠ 갈아탈 시간이 촉박해요 (2분 이하)</p>}
      <button className="btn btn--primary" onClick={props.onPick}>이 길로 안내 시작</button>
    </section>
  );
}

export function RouteChoiceScreen(props: {
  destName: string;
  routes: ClassifiedRoutes;
  onPick: (r: ScoredRoute) => void;
  onBack: () => void;
}) {
  const { routes } = props;
  return (
    <main className="screen">
      <header className="screen__header">
        <h1>{props.destName}</h1>
        <p className="muted">가는 방법을 골라 주세요</p>
      </header>
      <div className="route-grid">
        {routes.kind === 'SINGLE' ? (
          <RouteCard kind="single" route={routes.best} onPick={() => props.onPick(routes.best)} />
        ) : (
          <>
            <RouteCard kind="comfort" route={routes.comfort} onPick={() => props.onPick(routes.comfort)} />
            <RouteCard kind="fast" route={routes.fast} onPick={() => props.onPick(routes.fast)} />
          </>
        )}
      </div>
      <button className="btn btn--secondary" onClick={props.onBack}>처음으로</button>
    </main>
  );
}
