/**
 * 보호자에게 보낼 위치 공유 문자 메시지를 만듭니다.
 * 지도 링크는 Google 지도 검색 URL(https://maps.google.com/?q=위도,경도)을 사용합니다.
 */
export interface SosContext {
  lat: number;
  lng: number;
  /** GPS 실패 등으로 폴백 좌표인지 */
  approximate?: boolean;
  destName?: string;
  /** 지금 하고 있는 일 (예: "1호선 동대문 방향 탑승 중") */
  currentStep?: string;
  at?: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function mapsLink(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function buildSosMessage(ctx: SosContext): string {
  const at = ctx.at ?? new Date();
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const lines = [`[환승 도우미] 도움이 필요해요 (${time})`];
  if (ctx.destName) lines.push(`가는 곳: ${ctx.destName}`);
  if (ctx.currentStep) lines.push(`지금: ${ctx.currentStep}`);
  lines.push(`현재 위치${ctx.approximate ? '(정확하지 않음)' : ''}: ${mapsLink(ctx.lat, ctx.lng)}`);
  return lines.join('\n');
}

/**
 * sms: 링크. 안드로이드는 `?body=`, iOS는 `&body=` 를 쓰는 경우가 있어 userAgent로 구분합니다.
 */
export function buildSmsUri(phone: string, body: string, userAgent = ''): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  const sep = /iPhone|iPad|iPod/i.test(userAgent) ? '&' : '?';
  return `sms:${cleaned}${sep}body=${encodeURIComponent(body)}`;
}
