/**
 * 현재 위치(GPS)를 다시 조회하고, 실패하면 폴백 좌표를 돌려줍니다.
 * 폴백 좌표는 시연용 청량리역 부근 대략 좌표입니다.
 */
export interface LocationResult {
  x: number; // 경도
  y: number; // 위도
  accuracyM?: number;
  source: 'GPS' | 'FALLBACK';
  reason?: string;
}

export const FALLBACK_LOCATION = { x: 127.0469, y: 37.5803, name: '청량리역 부근(시연용)' } as const;

export function getCurrentLocation(timeoutMs = 6000, geo: Geolocation | undefined = globalThis.navigator?.geolocation): Promise<LocationResult> {
  const fallback = (reason: string): LocationResult => ({ x: FALLBACK_LOCATION.x, y: FALLBACK_LOCATION.y, source: 'FALLBACK', reason });
  if (!geo) return Promise.resolve(fallback('이 기기에서 위치 기능을 쓸 수 없어요'));
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; resolve(fallback('위치 확인이 오래 걸려요')); }
    }, timeoutMs + 500);
    geo.getCurrentPosition(
      (pos) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ x: pos.coords.longitude, y: pos.coords.latitude, accuracyM: pos.coords.accuracy, source: 'GPS' });
      },
      (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(fallback(err.code === 1 ? '위치 권한이 꺼져 있어요' : '위치를 찾지 못했어요'));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
