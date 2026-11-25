/**
 * 보호자 목적지 공유 링크: https://앱주소/?dest=서울대병원&ex=126.9990&ey=37.5797
 *  - dest: 목적지 이름, ex: 경도, ey: 위도 (ODsay 좌표 규칙과 동일하게 x=경도, y=위도)
 * 수도권 대략 범위를 벗어난 좌표는 잘못된 링크로 보고 거절합니다.
 */
export interface GuardianDestination {
  name: string;
  x: number;
  y: number;
}

/** 수도권 대략 범위 (경도 126.3~127.9, 위도 36.8~38.3) */
export const METRO_BOUNDS = { minX: 126.3, maxX: 127.9, minY: 36.8, maxY: 38.3 } as const;

export function isInMetroArea(x: number, y: number): boolean {
  return x >= METRO_BOUNDS.minX && x <= METRO_BOUNDS.maxX && y >= METRO_BOUNDS.minY && y <= METRO_BOUNDS.maxY;
}

export function encodeGuardianLink(baseUrl: string, dest: GuardianDestination): string {
  const url = new URL(baseUrl);
  url.searchParams.set('dest', dest.name);
  url.searchParams.set('ex', dest.x.toFixed(6));
  url.searchParams.set('ey', dest.y.toFixed(6));
  return url.toString();
}

export function decodeGuardianLink(search: string): GuardianDestination | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const name = (params.get('dest') ?? '').trim().slice(0, 60);
  const exRaw = params.get('ex');
  const eyRaw = params.get('ey');
  if (!name || exRaw === null || eyRaw === null || exRaw.trim() === '' || eyRaw.trim() === '') return null;
  const x = Number(exRaw);
  const y = Number(eyRaw);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !isInMetroArea(x, y)) return null;
  return { name, x, y };
}
