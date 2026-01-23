import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useStreamingAvatar } from '../hooks/useStreamingAvatar';
import { useVoiceInput } from '../hooks/useVoiceInput';
import {
  DEFAULT_AVATAR_CONFIG,
  type AvatarState,
  type VoiceInputState,
  type AvatarConfig,
} from '../types/assistant';

interface AssistantContextValue {
  // Avatar state
  avatarState: AvatarState;
  avatarVideoRef: React.RefObject<HTMLVideoElement | null>;
  initializeAvatar: () => Promise<void>;
  speakText: (text: string) => Promise<void>;
  interruptSpeaking: () => Promise<void>;
  disconnectAvatar: () => Promise<void>;

  // Voice input state
  voiceInputState: VoiceInputState;
  transcript: string;
  interimTranscript: string;
  isVoiceSupported: boolean;
  startVoiceInput: () => void;
  stopVoiceInput: () => void;
  resetTranscript: () => void;

  // Combined state
  isAvatarReady: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  error: string | null;
  clearError: () => void;

  // Settings
  config: AvatarConfig;
  updateConfig: (updates: Partial<AvatarConfig>) => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

interface AssistantProviderProps {
  children: ReactNode;
}

export function AssistantProvider({ children }: AssistantProviderProps) {
  const [config, setConfig] = useState<AvatarConfig>(DEFAULT_AVATAR_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [hasGreeted, setHasGreeted] = useState(false);

  const handleAvatarReady = useCallback(() => {
    if (!hasGreeted) {
      setHasGreeted(true);
    }
  }, [hasGreeted]);

  const handleError = useCallback((errorMessage: string) => {
    setError(errorMessage);
  }, []);

  const {
    state: avatarState,
    videoRef: avatarVideoRef,
    initialize: initializeAvatarInternal,
    speak,
    interrupt: interruptSpeaking,
    disconnect: disconnectAvatar,
    error: avatarError,
  } = useStreamingAvatar({
    config,
    onReady: handleAvatarReady,
    onError: handleError,
  });

  const {
    state: voiceInputState,
    transcript,
    interimTranscript,
    isSupported: isVoiceSupported,
    startListening: startVoiceInput,
    stopListening: stopVoiceInput,
    resetTranscript,
    error: voiceError,
  } = useVoiceInput({
    language: 'en-US',
    onError: handleError,
  });

  const initializeAvatar = useCallback(async () => {
    setHasGreeted(false);
    await initializeAvatarInternal();
  }, [initializeAvatarInternal]);

  const speakText = useCallback(async (text: string) => {
    await speak(text);
  }, [speak]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const updateConfig = useCallback((updates: Partial<AvatarConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  const combinedError = error || avatarError || voiceError;
  const isAvatarReady = avatarState === 'ready' || avatarState === 'speaking' || avatarState === 'listening';
  const isSpeaking = avatarState === 'speaking';
  const isListening = voiceInputState === 'listening';

  const value = useMemo<AssistantContextValue>(
    () => ({
      // Avatar
      avatarState,
      avatarVideoRef,
      initializeAvatar,
      speakText,
      interruptSpeaking,
      disconnectAvatar,

      // Voice
      voiceInputState,
      transcript,
      interimTranscript,
      isVoiceSupported,
      startVoiceInput,
      stopVoiceInput,
      resetTranscript,

      // Combined
      isAvatarReady,
      isSpeaking,
      isListening,
      error: combinedError,
      clearError,

      // Settings
      config,
      updateConfig,
    }),
    [
      avatarState,
      avatarVideoRef,
      initializeAvatar,
      speakText,
      interruptSpeaking,
      disconnectAvatar,
      voiceInputState,
      transcript,
      interimTranscript,
      isVoiceSupported,
      startVoiceInput,
      stopVoiceInput,
      resetTranscript,
      isAvatarReady,
      isSpeaking,
      isListening,
      combinedError,
      clearError,
      config,
      updateConfig,
    ]
  );

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant(): AssistantContextValue {
  const context = useContext(AssistantContext);
  if (!context) {
    throw new Error('useAssistant must be used within an AssistantProvider');
  }
  return context;
}
