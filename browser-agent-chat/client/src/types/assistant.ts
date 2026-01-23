export type AvatarState = 'loading' | 'ready' | 'speaking' | 'listening' | 'error' | 'disconnected';

export type VoiceInputState = 'idle' | 'listening' | 'processing' | 'error';

export interface AssistantState {
  avatarState: AvatarState;
  voiceInputState: VoiceInputState;
  isVoiceEnabled: boolean;
  isMuted: boolean;
  transcript: string;
  error: string | null;
}

export interface AvatarConfig {
  avatarId: string;
  voiceId: string;
  quality: 'low' | 'medium' | 'high';
  language: string;
}

export const DEFAULT_AVATAR_CONFIG: AvatarConfig = {
  avatarId: 'Wayne_20240711',
  voiceId: '',
  quality: 'medium',
  language: 'en',
};

export const ASSISTANT_GREETING = "Hi! I'm Alex, your browser assistant. What would you like me to help you with today?";
