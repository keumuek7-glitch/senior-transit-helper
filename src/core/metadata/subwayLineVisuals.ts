import { normalizeLineKey } from './stationTransferMetadata';

/**
 * 수도권 노선별 고유색.
 * 색상값은 널리 쓰이는 노선 대표색을 기준으로 넣었으며, 공식 디자인 가이드와 대조 확인이 필요합니다(README 참고).
 */
export interface LineVisual {
  key: string;
  /** 배너 배경색 */
  bgHex: string;
  /** 배너 글자색 (배경 대비 확보) */
  textHex: string;
  /** 음성/글로 부르는 한글 색깔명 */
  colorName: string;
}

const VISUALS: LineVisual[] = [
  { key: '1호선', bgHex: '#0052A4', textHex: '#FFFFFF', colorName: '남색' },
  { key: '2호선', bgHex: '#00A84D', textHex: '#FFFFFF', colorName: '초록색' },
  { key: '3호선', bgHex: '#EF7C1C', textHex: '#111111', colorName: '주황색' },
  { key: '4호선', bgHex: '#00A5DE', textHex: '#111111', colorName: '하늘색' },
  { key: '5호선', bgHex: '#996CAC', textHex: '#FFFFFF', colorName: '보라색' },
  { key: '6호선', bgHex: '#CD7C2F', textHex: '#111111', colorName: '황토색' },
  { key: '7호선', bgHex: '#747F00', textHex: '#FFFFFF', colorName: '올리브색' },
  { key: '8호선', bgHex: '#E6186C', textHex: '#FFFFFF', colorName: '분홍색' },
  { key: '9호선', bgHex: '#BDB092', textHex: '#111111', colorName: '금색' },
  { key: '경의중앙선', bgHex: '#77C4A3', textHex: '#111111', colorName: '청록색' },
  { key: '수인분당선', bgHex: '#F5A200', textHex: '#111111', colorName: '노란색' },
  { key: '신분당선', bgHex: '#D4003B', textHex: '#FFFFFF', colorName: '빨간색' },
  { key: '공항철도', bgHex: '#0090D2', textHex: '#FFFFFF', colorName: '파란색' },
];

const FALLBACK: LineVisual = { key: '기타', bgHex: '#333333', textHex: '#FFFFFF', colorName: '' };

/** 노선명(우선) 또는 ODsay subwayCode(1~9만 신뢰)로 색 정보를 찾습니다. */
export function getLineVisual(lineName?: string, subwayCode?: number): LineVisual {
  const key = normalizeLineKey(lineName);
  const byName = VISUALS.find((v) => key !== '' && (key === v.key || key.includes(v.key.replace('선', ''))));
  if (byName) return byName;
  if (subwayCode && subwayCode >= 1 && subwayCode <= 9) {
    return VISUALS.find((v) => v.key === `${subwayCode}호선`) ?? FALLBACK;
  }
  return { ...FALLBACK, key: key || FALLBACK.key };
}

/** 버스 배너 색 (노선 유형별 색은 아직 반영하지 않음) */
export const BUS_VISUAL: LineVisual = { key: '버스', bgHex: '#1F5F2B', textHex: '#FFFFFF', colorName: '' };
