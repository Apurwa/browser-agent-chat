import { useCallback, useEffect, useRef, useState } from 'react';
import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
  TaskType,
  type StartAvatarResponse,
} from '@heygen/streaming-avatar';
import type { AvatarState, AvatarConfig } from '../types/assistant';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface UseStreamingAvatarOptions {
  config: AvatarConfig;
  onReady?: () => void;
  onSpeakingStart?: () => void;
  onSpeakingEnd?: () => void;
  onError?: (error: string) => void;
}

interface UseStreamingAvatarReturn {
  state: AvatarState;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  initialize: () => Promise<void>;
  speak: (text: string) => Promise<void>;
  interrupt: () => Promise<void>;
  disconnect: () => Promise<void>;
  error: string | null;
}

async function fetchHeyGenToken(): Promise<string> {
  const response = await fetch(`${API_URL}/api/heygen/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch token: ${response.status}`);
  }

  const data = await response.json();
  return data.token;
}

function mapQuality(quality: AvatarConfig['quality']): AvatarQuality {
  const qualityMap: Record<AvatarConfig['quality'], AvatarQuality> = {
    low: AvatarQuality.Low,
    medium: AvatarQuality.Medium,
    high: AvatarQuality.High,
  };
  return qualityMap[quality];
}

export function useStreamingAvatar({
  config,
  onReady,
  onSpeakingStart,
  onSpeakingEnd,
  onError,
}: UseStreamingAvatarOptions): UseStreamingAvatarReturn {
  const [state, setState] = useState<AvatarState>('disconnected');
  const [error, setError] = useState<string | null>(null);

  const avatarRef = useRef<StreamingAvatar | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionDataRef = useRef<StartAvatarResponse | null>(null);

  const handleError = useCallback((errorMessage: string) => {
    setError(errorMessage);
    setState('error');
    onError?.(errorMessage);
  }, [onError]);

  const initialize = useCallback(async () => {
    if (avatarRef.current) {
      await avatarRef.current.stopAvatar();
    }

    setState('loading');
    setError(null);

    try {
      const token = await fetchHeyGenToken();

      const avatar = new StreamingAvatar({ token });
      avatarRef.current = avatar;

      avatar.on(StreamingEvents.STREAM_READY, (event) => {
        if (videoRef.current && event.detail) {
          videoRef.current.srcObject = event.detail;
          videoRef.current.play().catch(() => {
            // Autoplay might be blocked, user interaction needed
          });
        }
        setState('ready');
        onReady?.();
      });

      avatar.on(StreamingEvents.AVATAR_START_TALKING, () => {
        setState('speaking');
        onSpeakingStart?.();
      });

      avatar.on(StreamingEvents.AVATAR_STOP_TALKING, () => {
        setState('ready');
        onSpeakingEnd?.();
      });

      avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        setState('disconnected');
        avatarRef.current = null;
        sessionDataRef.current = null;
      });

      const avatarConfig: Parameters<typeof avatar.createStartAvatar>[0] = {
        avatarName: config.avatarId,
        quality: mapQuality(config.quality),
        language: config.language,
      };

      // Only add voice if voiceId is specified
      if (config.voiceId) {
        avatarConfig.voice = { voiceId: config.voiceId };
      }

      console.log('Creating avatar with config:', avatarConfig);
      const sessionData = await avatar.createStartAvatar(avatarConfig);

      sessionDataRef.current = sessionData;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize avatar';
      handleError(message);
    }
  }, [config, handleError, onReady, onSpeakingStart, onSpeakingEnd]);

  const speak = useCallback(async (text: string) => {
    if (!avatarRef.current || state === 'disconnected' || state === 'loading') {
      return;
    }

    try {
      await avatarRef.current.speak({
        text,
        taskType: TaskType.REPEAT,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to speak';
      handleError(message);
    }
  }, [state, handleError]);

  const interrupt = useCallback(async () => {
    if (!avatarRef.current) return;

    try {
      await avatarRef.current.interrupt();
      setState('ready');
    } catch (err) {
      // Ignore interrupt errors
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (!avatarRef.current) return;

    try {
      await avatarRef.current.stopAvatar();
    } catch (err) {
      // Ignore disconnect errors
    } finally {
      avatarRef.current = null;
      sessionDataRef.current = null;
      setState('disconnected');
    }
  }, []);

  useEffect(() => {
    return () => {
      if (avatarRef.current) {
        avatarRef.current.stopAvatar().catch(() => {});
      }
    };
  }, []);

  return {
    state,
    videoRef,
    initialize,
    speak,
    interrupt,
    disconnect,
    error,
  };
}
