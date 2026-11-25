import { useState } from 'react';
import type { GuardianDestination } from '../core/guardian/guardianLinkCodec';

export interface Favorite {
  id: string;
  label: string;
  name: string;
  x: number;
  y: number;
}

export function HomeScreen(props: {
  favorites: Favorite[];
  guardianDest: GuardianDestination | null;
  resumeAvailable: { destName: string } | null;
  originLabel: string;
  guardianPhone: string;
  loading: boolean;
  error: string | null;
  onGo: (dest: { name: string; x: number; y: number }) => void;
  onResume: () => void;
  onDiscardResume: () => void;
  onSavePhone: (phone: string) => void;
}) {
  const [phoneDraft, setPhoneDraft] = useState(props.guardianPhone);
  return (
    <main className="screen">
      <header className="screen__header">
        <h1>어디로 가세요?</h1>
        <p className="muted">출발: {props.originLabel}</p>
      </header>

      {props.resumeAvailable && (
        <div className="banner banner--info">
          <p className="banner__title">{props.resumeAvailable.destName} 가는 길 안내가 진행 중이었어요</p>
          <button className="btn btn--primary" onClick={props.onResume}>이어서 안내 받기</button>
          <button className="btn btn--secondary" onClick={props.onDiscardResume}>새로 시작</button>
        </div>
      )}

      {props.guardianDest && (
        <div className="banner banner--guardian">
          <p className="banner__title">보호자가 보낸 목적지</p>
          <p className="big">{props.guardianDest.name}</p>
          <button className="btn btn--primary" disabled={props.loading} onClick={() => props.onGo(props.guardianDest!)}>
            이 곳으로 길 찾기
          </button>
        </div>
      )}

      <div className="stack">
        {props.favorites.map((f) => (
          <button key={f.id} className="btn btn--favorite" disabled={props.loading} onClick={() => props.onGo(f)}>
            <span className="btn__label">{f.label}</span>
            <span className="btn__sub">{f.name}</span>
          </button>
        ))}
      </div>

      {props.loading && <p className="status" role="status">길을 찾고 있어요…</p>}
      {props.error && <p className="status status--error" role="alert">{props.error}</p>}

      <details className="settings">
        <summary>보호자 연락처 설정</summary>
        <label className="field">
          <span>보호자 휴대폰 번호</span>
          <input
            inputMode="tel"
            value={phoneDraft}
            placeholder="010-0000-0000"
            onChange={(e) => setPhoneDraft(e.target.value)}
          />
        </label>
        <button className="btn btn--secondary" onClick={() => props.onSavePhone(phoneDraft)}>저장</button>
      </details>
    </main>
  );
}
