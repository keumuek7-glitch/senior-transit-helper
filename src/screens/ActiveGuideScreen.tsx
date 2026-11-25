import type { ReactNode } from 'react';
import { currentLeg, type MultiLegState } from '../core/stateMachine/multiLegManager';
import { isRideLeg, type RideLeg } from '../core/stateMachine/routeLegBuilder';
import { currentTransitVM, remainingStops, type TransitState } from '../core/stateMachine/transitStateMachine';
import { arrivedVM } from '../core/tts/guidanceSpeechBuilder';
import {
  AccessWalkCard,
  ExitGuidanceCard,
  GuidanceBody,
  LineBanner,
  TransferGuidanceCard,
  rideLabel,
  type SpeechBinding,
} from '../components/GuidanceCards';

function StopProgress({ leg, t }: { leg: RideLeg; t: TransitState }) {
  const pos = Math.max(t.anchorIndex, t.estimatedIndex);
  return (
    <ol className="stops" aria-label="정차 목록">
      {leg.stations.map((name, i) => (
        <li
          key={`${name}-${i}`}
          className={[
            'stops__item',
            i < pos ? 'is-past' : '',
            i === pos ? 'is-current' : '',
            i === leg.stations.length - 1 ? 'is-target' : '',
          ].join(' ')}
        >
          {name}
          {i === leg.stations.length - 1 && ' (내림)'}
        </li>
      ))}
    </ol>
  );
}

function RideView(props: {
  leg: RideLeg;
  t: TransitState;
  onBoarded: () => void;
  onAlighted: () => void;
  onReroute: () => void;
  speak: (text: string) => void;
}) {
  const { leg, t } = props;
  const vm = currentTransitVM(leg, t);
  const remaining = remainingStops(leg, t);
  return (
    <div className="stack">
      <LineBanner visual={leg.visual} label={`${rideLabel(leg)} · ${leg.boardName} → ${leg.alightName}`} />
      {t.phase !== 'WAITING_BOARDING' && t.phase !== 'WRONG_DIRECTION_SUSPECTED' && (
        <div className="countdown" aria-live="polite">
          <span className="countdown__num">{remaining}</span>
          <span className="countdown__label">정거장 남음</span>
        </div>
      )}
      <GuidanceBody vm={vm} onReplay={() => props.speak(vm.speech)} />
      {t.phase === 'WAITING_BOARDING' ? (
        <button className="btn btn--primary" onClick={props.onBoarded}>
          {leg.type === 'BUS_LEG' ? '버스를 탔어요' : '열차를 탔어요'}
        </button>
      ) : t.phase === 'WRONG_DIRECTION_SUSPECTED' ? (
        <button className="btn btn--primary" onClick={props.onReroute}>지금 위치에서 길 다시 찾기</button>
      ) : (
        <button className="btn btn--primary" onClick={props.onAlighted}>내렸어요</button>
      )}
      {t.phase !== 'WAITING_BOARDING' && <StopProgress leg={leg} t={t} />}
    </div>
  );
}

export function ActiveGuideScreen(props: {
  session: MultiLegState;
  binding: SpeechBinding;
  onBoarded: () => void;
  onAlighted: () => void;
  onWalkDone: () => void;
  onReroute: () => void;
  onFinish: () => void;
}) {
  const { session, binding } = props;
  const leg = currentLeg(session);
  const step = `${Math.min(session.currentIndex + 1, session.legs.length)} / ${session.legs.length}단계`;

  let body: ReactNode;
  if (session.finished || !leg) {
    body = (
      <div className="stack">
        <GuidanceBody vm={arrivedVM(session.destName)} />
        <button className="btn btn--primary" onClick={props.onFinish}>처음 화면으로</button>
      </div>
    );
  } else if (isRideLeg(leg) && session.transit) {
    body = (
      <RideView
        leg={leg}
        t={session.transit}
        onBoarded={props.onBoarded}
        onAlighted={props.onAlighted}
        onReroute={props.onReroute}
        speak={binding.speak}
      />
    );
  } else if (leg.type === 'TRANSFER_WALK_LEG') {
    const Card = leg.walkKind === 'TRANSFER' ? TransferGuidanceCard : leg.walkKind === 'EXIT' ? ExitGuidanceCard : AccessWalkCard;
    body = <Card key={leg.id} leg={leg} onDone={props.onWalkDone} {...binding} />;
  }

  return (
    <main className="screen screen--guide">
      <header className="screen__header screen__header--compact">
        <p className="muted">{session.destName} 가는 길 · {step}</p>
      </header>
      {body}
    </main>
  );
}
