import { Langfuse } from 'langfuse';

export interface TraceSummary {
  id: string;
  name: string;
  input: unknown;
  latency: number | null;
  totalCost: number | null;
  status: 'success' | 'error';
  observationCount: number;
  timestamp: string;
  sessionId: string | null;
}

export interface TraceObservation {
  name: string | null;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  model: string | null;
  tokenCount: number | null;
  level: string;
}

export interface TraceDetail {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  latency: number | null;
  totalCost: number | null;
  status: 'success' | 'error';
  timestamp: string;
  observations: TraceObservation[];
}

export interface TracePaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

function deriveStatus(output: unknown): 'success' | 'error' {
  if (output && typeof output === 'object' && 'success' in output) {
    return (output as { success: boolean }).success ? 'success' : 'error';
  }
  return 'success';
}

let langfuse: Langfuse | null = null;

export function isLangfuseEnabled(): boolean {
  return langfuse !== null;
}

export function getLangfuse(): Langfuse | null {
  return langfuse;
}

export function initLangfuse(): void {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    console.log('[LANGFUSE] Missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY — tracing disabled');
    return;
  }

  langfuse = new Langfuse({
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_BASE_URL || 'http://localhost:3000',
  });

  console.log('[LANGFUSE] Tracing enabled');
}

export async function shutdownLangfuse(): Promise<void> {
  if (langfuse) {
    await langfuse.shutdownAsync();
    console.log('[LANGFUSE] Flushed and shut down');
  }
}

export async function fetchAgentTraces(
  agentId: string,
  page = 1,
  limit = 50
): Promise<{ traces: TraceSummary[]; meta: TracePaginationMeta }> {
  if (!langfuse) throw new Error('Langfuse not initialized');

  const result = await langfuse.api.traceList({
    tags: [`agent:${agentId}`],
    page,
    limit,
    orderBy: 'timestamp.desc',
  });

  const traces: TraceSummary[] = result.data.map(t => ({
    id: t.id,
    name: t.name ?? 'unnamed',
    input: t.input,
    latency: t.latency ?? null,
    totalCost: t.totalCost ?? null,
    status: deriveStatus(t.output),
    observationCount: t.observations?.length ?? 0,
    timestamp: t.timestamp,
    sessionId: t.sessionId ?? null,
  }));

  return {
    traces,
    meta: {
      page: result.meta.page,
      limit: result.meta.limit,
      totalItems: result.meta.totalItems,
      totalPages: result.meta.totalPages,
    },
  };
}

export async function fetchTraceDetail(traceId: string): Promise<TraceDetail> {
  if (!langfuse) throw new Error('Langfuse not initialized');

  const t = await langfuse.api.traceGet(traceId);

  const observations: TraceObservation[] = (t.observations ?? []).map(obs => {
    const startMs = new Date(obs.startTime).getTime();
    const endMs = obs.endTime ? new Date(obs.endTime).getTime() : null;
    const duration = endMs !== null ? (endMs - startMs) / 1000 : null;

    let tokenCount: number | null = null;
    if (obs.usage) {
      const u = obs.usage as { total?: number; input?: number; output?: number };
      tokenCount = u.total ?? (((u.input ?? 0) + (u.output ?? 0)) || null);
    }

    return {
      name: obs.name ?? null,
      startTime: obs.startTime,
      endTime: obs.endTime ?? null,
      duration,
      model: obs.model ?? null,
      tokenCount,
      level: obs.level ?? 'DEFAULT',
    };
  });

  // Sort observations by startTime
  observations.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return {
    id: t.id,
    name: t.name ?? 'unnamed',
    input: t.input,
    output: t.output,
    latency: t.latency ?? null,
    totalCost: t.totalCost ?? null,
    status: deriveStatus(t.output),
    timestamp: t.timestamp,
    observations,
  };
}
