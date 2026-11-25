import type { RideLeg, WalkLeg } from '../stateMachine/routeLegBuilder';

/**
 * 카드에 보이는 글과 TTS로 읽는 말을 한 곳에서 만듭니다(단일 소스).
 * 화면 글과 음성 내용이 어긋나지 않도록 모든 안내 문구는 여기서만 만듭니다.
 */
export interface GuidanceViewModel {
  /** 카드 제목 (가장 큰 글씨) */
  title: string;
  /** 보조 줄 */
  lines: string[];
  /** 위험·주의 강조 여부 */
  tone: 'normal' | 'alert' | 'warning';
  /** TTS 문장 (전처리 전) */
  speech: string;
}

/** TTS 발음 전처리: '4-2번 문' → '4 다시 2번 문', '30m' → '30미터' */
export function preprocessForSpeech(text: string): string {
  return text
    .replace(/(\d+)\s*-\s*(\d+)/g, '$1 다시 $2')
    .replace(/(\d+(?:\.\d+)?)\s*km\b/gi, '$1킬로미터')
    .replace(/(\d+(?:\.\d+)?)\s*m\b/gi, '$1미터')
    .replace(/[·|]/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

const vm = (title: string, lines: string[], tone: GuidanceViewModel['tone'] = 'normal', speech?: string): GuidanceViewModel => ({
  title,
  lines,
  tone,
  speech: speech ?? [title, ...lines].join('. '),
});

function rideName(leg: RideLeg): string {
  if (leg.type === 'BUS_LEG') return `${leg.busNo ?? ''}번 버스`.trim();
  const color = leg.visual.colorName ? ` ${leg.visual.colorName}` : '';
  return `${leg.lineKey}${color} 열차`;
}

export function boardingVM(leg: RideLeg): GuidanceViewModel {
  const stops = leg.stations.length - 1;
  const lines: string[] = [];
  if (leg.nextStation) {
    lines.push(leg.type === 'BUS_LEG' ? `${leg.boardName}에서 타세요` : `다음 역이 '${leg.nextStation}'인 쪽에서 타세요`);
  }
  if (leg.quickDoor) lines.push(`${leg.quickDoor}번 문 앞에서 타시면 내릴 때 가까워요`);
  lines.push(`${leg.alightName}까지 ${stops}정거장`);
  return vm(`${rideName(leg)}를 타세요`, lines);
}

export function inTransitVM(leg: RideLeg, remainingStops: number, currentName?: string): GuidanceViewModel {
  const lines = [`${leg.alightName}에서 내려요`];
  if (currentName) lines.push(`지금: ${currentName} 근처`);
  return vm(`${remainingStops}정거장 남았어요`, lines, 'normal', `${leg.alightName}까지 ${remainingStops}정거장 남았어요`);
}

export function stationConfirmedVM(leg: RideLeg, stationName: string, remainingStops: number): GuidanceViewModel {
  return vm(
    `${stationName}역입니다`,
    [`${leg.alightName}까지 ${remainingStops}정거장 남았어요`],
    'normal',
    `${stationName}입니다. ${leg.alightName}까지 ${remainingStops}정거장 남았어요`,
  );
}

export function preAlightVM(leg: RideLeg): GuidanceViewModel {
  const where = leg.type === 'BUS_LEG' ? '정류장' : '역';
  return vm(
    `다음 ${where}에서 내리세요`,
    [`내리실 곳: ${leg.alightName}`, '천천히 일어날 준비를 하세요'],
    'alert',
    `곧 내리실 차례예요. 다음 ${where} ${leg.alightName}에서 내리세요`,
  );
}

export function driftHoldVM(leg: RideLeg): GuidanceViewModel {
  return vm(
    '열차가 평소보다 천천히 가요',
    [`아직 내리지 마세요`, `"${leg.alightName}" 안내 방송을 들으시면 내리세요`],
    'warning',
    `열차가 평소보다 천천히 가고 있어요. 아직 내리지 마시고, ${leg.alightName} 안내 방송을 들어 주세요`,
  );
}

export function wrongDirectionVM(leg: RideLeg, observed: string): GuidanceViewModel {
  return vm(
    '반대로 가는 것 같아요',
    [`지금 역: ${observed}`, '다음 역에서 내려 건너편 열차를 타시거나', '[길 다시 찾기]를 눌러 주세요'],
    'warning',
    `반대 방향으로 가고 있는 것 같아요. 지금 ${observed}입니다. ${leg.alightName} 방향이 맞는지 확인해 주세요`,
  );
}

export function alightedVM(leg: RideLeg): GuidanceViewModel {
  return vm(`${leg.alightName}에서 내리셨어요`, ['다음 안내로 넘어갈게요'], 'normal', `${leg.alightName}에서 내리셨어요`);
}

export function walkVM(leg: WalkLeg): GuidanceViewModel {
  const minutes = Math.max(1, Math.round(leg.adjustedMin));
  if (leg.walkKind === 'TRANSFER') {
    const g = leg.railGuide;
    const toName = leg.nextRide ? (leg.nextRide.type === 'BUS_LEG' ? `${leg.nextRide.busNo}번 버스` : leg.nextRide.lineKey) : '다음 차';
    const lines = [...(g?.steps ?? [`${toName} 타는 곳 표지판을 따라가세요`])];
    if (g?.elevator) lines.push('엘리베이터가 있어요');
    lines.push(`약 ${leg.distanceM}m, 천천히 ${minutes}분`);
    return vm(`${toName}(으)로 갈아타세요`, lines);
  }
  if (leg.walkKind === 'EXIT') {
    const e = leg.exitGuide;
    const lines = e ? [`${e.exitNo}번 출구${e.elevatorExit ? '(엘리베이터)' : ''}로 나가세요`, ...e.steps] : ['목적지 방향 출구로 나가세요'];
    lines.push(`약 ${leg.distanceM}m, 천천히 ${minutes}분`);
    return vm(`${leg.toName ?? '목적지'}까지 걸어가요`, lines);
  }
  const target = leg.nextRide?.boardName ?? leg.toName ?? '타는 곳';
  return vm(`${target}까지 걸어가요`, [`약 ${leg.distanceM}m, 천천히 ${minutes}분`]);
}

export function arrivedVM(destName: string): GuidanceViewModel {
  return vm('도착했어요', [`${destName}에 도착하셨어요`, '수고 많으셨어요'], 'normal', `${destName}에 도착하셨어요. 수고 많으셨어요`);
}
