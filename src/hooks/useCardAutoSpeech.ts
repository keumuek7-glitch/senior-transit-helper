import { useCallback, useEffect, useRef } from 'react';

/**
 * 카드가 처음 보일 때 한 번만 읽고, [다시 듣기]로 재생할 수 있게 합니다.
 * spokenKeys(세션 공통)에 이미 있는 key면 읽지 않습니다 → 상위 디스패처와 중복 발화 방지.
 */
export function useCardAutoSpeech(
  key: string,
  text: string,
  speak: (text: string) => void,
  spoken: { has(k: string): boolean; add(k: string): void },
) {
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastKey.current === key) return; // StrictMode 이중 실행·재렌더 방지
    lastKey.current = key;
    if (spoken.has(key)) return;
    spoken.add(key);
    speak(text);
  }, [key, text, speak, spoken]);

  return useCallback(() => speak(text), [speak, text]);
}
