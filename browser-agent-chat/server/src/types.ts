// === Database Models ===

export interface Project {
  id: string;
  user_id: string;
  name: string;
  url: string;
  credentials: EncryptedCredentials | null;
  context: string | null;
  created_at: string;
  updated_at: string;
}

export interface EncryptedCredentials {
  iv: string;
  encrypted: string;
  tag: string;
}

export interface PlaintextCredentials {
  username: string;
  password: string;
}

export interface Feature {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  criticality: Criticality;
  expected_behaviors: string[];
  created_at: string;
  updated_at: string;
  flows?: Flow[];
}

export interface Flow {
  id: string;
  feature_id: string;
  project_id: string;
  name: string;
  steps: FlowStep[];
  checkpoints: Checkpoint[];
  criticality: Criticality;
  created_at: string;
  updated_at: string;
}

export interface FlowStep {
  order: number;
  description: string;
  url?: string;
}

export interface Checkpoint {
  description: string;
  expected: string;
}

export interface Finding {
  id: string;
  project_id: string;
  session_id: string;
  title: string;
  description: string | null;
  type: FindingType;
  severity: Criticality;
  feature: string | null;
  flow: string | null;
  steps_to_reproduce: ReproStep[];
  expected_behavior: string | null;
  actual_behavior: string | null;
  screenshot_url: string | null;
  status: FindingStatus;
  created_at: string;
}

export interface ReproStep {
  order: number;
  action: string;
  target?: string;
}

export interface Session {
  id: string;
  project_id: string;
  started_at: string;
  ended_at: string | null;
  findings_count: number;
}

export interface Message {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}

// === Enums ===

export type Criticality = 'critical' | 'high' | 'medium' | 'low';
export type FindingType = 'visual' | 'functional' | 'data' | 'ux';
export type FindingStatus = 'new' | 'confirmed' | 'dismissed';
export type MessageRole = 'user' | 'agent' | 'thought' | 'action' | 'system';
export type AgentStatus = 'idle' | 'working' | 'error' | 'disconnected' | 'crashed' | 'interrupted';

// === Redis Session State ===

export interface RedisSession {
  dbSessionId: string;
  status: RedisSessionStatus;
  cdpPort: number;
  cdpEndpoint: string;
  currentUrl: string;
  memoryContext: string;
  browserPid: number;
  lastTask: string;
  createdAt: number;
  lastActivityAt: number;
}

export type RedisSessionStatus = 'idle' | 'working' | 'disconnected' | 'crashed' | 'interrupted';

// === Navigation Graph ===

export interface NavNode {
  id: string;
  projectId: string;
  urlPattern: string;
  pageTitle: string;
  description: string;
  firstSeenAt: string;
  lastSeenAt: string;
  features: string[]; // feature names, populated from nav_node_features join
}

export interface NavEdge {
  id: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  actionLabel: string;
  selector: string | null;
  rawTarget: string | null;
  discoveredAt: string;
}

export interface NavGraph {
  nodes: NavNode[];
  edges: NavEdge[];
}

// === Muscle Memory ===

export interface LearnedPattern {
  id: string;
  project_id: string;
  pattern_type: 'login' | 'navigation';
  trigger: LoginTrigger;
  steps: PlaywrightStep[];
  consecutive_failures: number;
  status: 'active' | 'stale';
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoginTrigger {
  type: 'login';
  url_pattern: string;
}

export interface PlaywrightStep {
  action: 'fill' | 'click' | 'type' | 'press';
  selector: string;
  value?: string;
  waitAfter?: number;
}

// === Suggestions ===

export interface Suggestion {
  id: string;
  project_id: string;
  type: 'feature' | 'flow' | 'behavior';
  status: 'pending' | 'accepted' | 'dismissed';
  data: FeatureSuggestionData | FlowSuggestionData | BehaviorSuggestionData;
  source_session: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface FeatureSuggestionData {
  name: string;
  description: string;
  criticality: Criticality;
  expected_behaviors: string[];
  discovered_at_url?: string; // URL where feature was observed during exploration
}

export interface FlowSuggestionData {
  feature_name: string;
  name: string;
  steps: FlowStep[];
  checkpoints: Checkpoint[];
  criticality: Criticality;
}

export interface BehaviorSuggestionData {
  feature_name: string;
  behavior: string;
}

// === WebSocket Messages ===

export type ClientMessage =
  | { type: 'start'; projectId: string; resumeUrl?: string }
  | { type: 'resume'; projectId: string }
  | { type: 'task'; content: string }
  | { type: 'explore'; projectId: string }
  | { type: 'stop' }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'thought'; content: string }
  | { type: 'action'; action: string; target?: string }
  | { type: 'screenshot'; data: string }
  | { type: 'status'; status: AgentStatus }
  | { type: 'nav'; url: string }
  | { type: 'error'; message: string }
  | { type: 'taskComplete'; success: boolean }
  | { type: 'finding'; finding: Finding }
  | { type: 'suggestion'; suggestion: Suggestion }
  | { type: 'pong' }
  | { type: 'sessionRestore'; messages: ChatMessage[] }
  | { type: 'metrics'; metrics: StartupMetrics }
  | { type: 'sessionCrashed' }
  | { type: 'taskInterrupted'; task: string };

// === API Request/Response ===

export interface CreateProjectRequest {
  name: string;
  url: string;
  credentials: PlaintextCredentials;
  context?: string;
}

export interface ProjectResponse {
  id: string;
  name: string;
  url: string;
  hasCredentials: boolean;
  context: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectListItem extends ProjectResponse {
  findings_count: number;
  last_session_at: string | null;
}

export interface CreateFeatureRequest {
  name: string;
  description?: string;
  criticality: Criticality;
  expected_behaviors?: string[];
}

export interface CreateFlowRequest {
  name: string;
  steps: FlowStep[];
  checkpoints?: Checkpoint[];
  criticality: Criticality;
}

// === Startup Metrics ===

export interface MetricStep {
  name: string;
  duration: number;
}

export interface StartupMetrics {
  total: number;
  steps: MetricStep[];
}

// === Chat Messages (for session persistence) ===

export interface ChatMessage {
  id: string;
  type: 'user' | 'agent' | 'system' | 'finding';
  content: string;
  timestamp: number;
}
