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

// --- Credential Vault Types ---

export interface VaultEntry {
  id: string;
  user_id: string;
  label: string;
  credential_type: string;
  metadata: { username?: string; notes?: string };
  domains: string[];
  scope: string;
  version: number;
  use_count: number;
  last_used_at: string | null;
  last_used_by_agent: string | null;
  created_by_agent: string | null;
  created_at: string;
  updated_at: string;
  enabled: boolean;
  bindings?: Array<{ agentId: string; agentName: string }>
}

export interface BoundCredential extends VaultEntry {
  usage_context: string | null;
  priority: number;
  binding_id: string;
}

export interface CredentialNeededEvent {
  type: 'credential_needed';
  agentId: string;
  domain: string;
  strategy: string;
}
