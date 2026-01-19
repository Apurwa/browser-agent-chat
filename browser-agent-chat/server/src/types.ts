// Client → Server messages
export type ClientMessage =
  | { type: 'start'; url: string }
  | { type: 'task'; content: string }
  | { type: 'stop' };

// Server → Client messages
export type ServerMessage =
  | { type: 'thought'; content: string }
  | { type: 'action'; action: string; target?: string }
  | { type: 'screenshot'; data: string }
  | { type: 'status'; status: AgentStatus }
  | { type: 'nav'; url: string }
  | { type: 'error'; message: string }
  | { type: 'taskComplete'; success: boolean };

export type AgentStatus = 'idle' | 'working' | 'error' | 'disconnected';

export interface ChatMessage {
  id: string;
  type: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
}
