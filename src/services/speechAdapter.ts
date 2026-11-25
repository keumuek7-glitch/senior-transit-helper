import { preprocessForSpeech } from '../core/tts/guidanceSpeechBuilder';

/**
 * 음성 출력 어댑터. 기본은 Web Speech API (ko-KR, rate 0.88).
 * 화면이 백그라운드일 때는 말하지 않고 알림(Notification)·진동으로 대신하고,
 * 마지막 문장을 보관했다가 화면으로 돌아오면 다시 읽습니다(복귀 발화).
 */
export interface SpeechAdapter {
  speak(text: string): void;
  cancel(): void;
  readonly supported: boolean;
}

export function createWebSpeechAdapter(): SpeechAdapter {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  let pending: string | null = null;

  const pickVoice = () => synth?.getVoices().find((v) => v.lang?.toLowerCase().startsWith('ko'));

  const speakNow = (text: string) => {
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(preprocessForSpeech(text));
    u.lang = 'ko-KR';
    u.rate = 0.88;
    const voice = pickVoice();
    if (voice) u.voice = voice;
    synth.speak(u);
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && pending) {
        const text = pending;
        pending = null;
        speakNow(`다시 알려 드릴게요. ${text}`);
      }
    });
  }

  return {
    supported: !!synth,
    speak(text: string) {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        pending = text;
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('환승 도우미', { body: text });
          }
        } catch {
          /* 일부 브라우저는 페이지에서 Notification 생성 불가 */
        }
        navigator.vibrate?.([300, 150, 300]);
        return;
      }
      speakNow(text);
    },
    cancel() {
      synth?.cancel();
    },
  };
}

/** 진동 (지원 안 하면 무시) */
export function vibrate(pattern: number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* noop */
  }
}
