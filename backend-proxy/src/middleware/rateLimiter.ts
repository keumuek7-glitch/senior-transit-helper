import type { NextFunction, Request, Response } from 'express';

/**
 * IP 기반 고정 창(fixed window) 요청 제한. 기본 1분당 30회.
 * 초과 시 HTTP 429 + Retry-After(초).
 * 단일 프로세스 인메모리 구현이므로 서버를 여러 대 띄우면 공유되지 않습니다.
 */
export interface RateLimiterOptions {
  windowMs?: number;
  max?: number;
  now?: () => number;
}

export function createRateLimiter(opts: RateLimiterOptions = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 30;
  const now = opts.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const t = now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: '요청이 너무 많습니다.', retryAfter } });
      return;
    }
    // 오래된 항목 정리
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    }
    next();
  };
  return middleware;
}
